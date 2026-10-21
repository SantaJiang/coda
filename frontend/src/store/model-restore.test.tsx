import { afterEach, expect, it, vi } from "vitest"
import { render } from "solid-js/web"
import { AppProvider, useModels } from "./app"
import { ModelMenu } from "../components/ModelMenu"
import type { ModelApi } from "./contracts"
import type { AgentClient } from "./ports"
import type { ProviderList } from "../lib/models"
import { flushShared } from "../lib/shared"

vi.mock("../lib/persist", async (original) => ({
  ...await original<typeof import("../lib/persist")>(),
  resolveHomeDir: async () => null,
}))

const freeKey = "opencode/free-fixture"
const customKey = "fixture/deepseek-v4-flash"
const providers: ProviderList = {
  all: [{ id: "opencode", name: "Coda", models: { "free-fixture": { name: "Free fixture" } } }],
  connected: ["opencode"], default: {},
}
const disposers: Array<() => void> = []

function mount(listProviders: AgentClient["listProviders"]) {
  const container = document.createElement("div")
  document.body.append(container)
  let models!: ModelApi
  function Probe() { models = useModels(); return <ModelMenu /> }
  const client = {
    healthcheck: async () => true,
    patchGlobalConfig: async () => undefined,
    listProjects: async () => [],
    listProviders,
  } as unknown as AgentClient
  const dispose = render(() => <AppProvider ports={{ client, subscribe: () => () => {} }}><Probe /></AppProvider>, container)
  const close = () => { dispose(); container.remove() }
  disposers.push(close)
  return { container, models, close }
}

function seed() {
  localStorage.setItem("coda.models", JSON.stringify([{
    id: "m", providerID: "fixture", providerName: "Fixture", modelID: "deepseek-v4-flash",
    name: "deepseek-v4-flash", baseURL: "https://example.test/v1", apiKey: "fixture",
  }]))
}

afterEach(async () => {
  for (const dispose of disposers.splice(0)) dispose()
  await flushShared()
  localStorage.clear()
})

it("restores a free model selected through the menu after remount with delayed discovery", async () => {
  seed()
  const first = mount(async () => providers)
  await vi.waitFor(() => expect(first.models.selectableModels().some((model) => model.key === freeKey)).toBe(true))
  first.container.querySelector<HTMLButtonElement>(".model-chip")!.click()
  const row = [...first.container.querySelectorAll<HTMLButtonElement>(".model-menu-item")].find((item) => item.textContent?.includes("Free fixture"))!
  row.click()
  expect(localStorage.getItem("coda.selectedModel")).toBe(freeKey)
  first.close()
  let resolve!: (value: ProviderList) => void
  const pending = new Promise<ProviderList>((done) => { resolve = done })
  const second = mount(() => pending)
  expect(second.models.selectedModelKey()).toBe(freeKey)
  expect(localStorage.getItem("coda.selectedModel")).toBe(freeKey)
  resolve(providers)
  await vi.waitFor(() => expect(second.container.querySelector(".model-chip")?.textContent).toBe("Free fixture"))
  expect(localStorage.getItem("coda.selectedModel")).toBe(freeKey)
})

it("keeps the saved choice on discovery failure and falls back only after a successful unavailable result", async () => {
  seed()
  localStorage.setItem("coda.selectedModel", freeKey)
  const list = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ all: [], connected: [], default: {} })
  const app = mount(list)
  await vi.waitFor(() => expect(list).toHaveBeenCalledOnce())
  expect(app.models.selectedModelKey()).toBe(freeKey)
  expect(localStorage.getItem("coda.selectedModel")).toBe(freeKey)
  await app.models.refreshDiscovered()
  expect(app.models.selectedModelKey()).toBe(customKey)
  expect(localStorage.getItem("coda.selectedModel")).toBe(customKey)
})

it("respects a new user selection while startup discovery is pending", async () => {
  seed()
  localStorage.setItem("coda.selectedModel", freeKey)
  let resolve!: (value: ProviderList) => void
  const pending = new Promise<ProviderList>((done) => { resolve = done })
  const app = mount(() => pending)
  app.models.selectModel(customKey)
  resolve(providers)
  await vi.waitFor(() => expect(app.models.selectableModels()).toHaveLength(2))
  expect(app.models.selectedModelKey()).toBe(customKey)
  expect(localStorage.getItem("coda.selectedModel")).toBe(customKey)
})
