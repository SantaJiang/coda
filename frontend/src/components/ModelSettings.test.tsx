import { afterEach, expect, it, vi } from "vitest"
import { render } from "solid-js/web"
import { createStore } from "solid-js/store"
import { StoreProviders } from "../store/ctx"
import { createModelSlice } from "../store/model-slice"
import { initialState, type AppState } from "../store/state"
import type { AgentClient } from "../store/ports"
import type { ChromeApi, ProjectApi, RuntimeApi } from "../store/contracts"
import { ModelSettings } from "./ModelSettings"

vi.mock("../lib/catalog", () => ({
  modelCatalog: vi.fn(),
}))

import { modelCatalog } from "../lib/catalog"

const catalog = [
  {
    id: "zai",
    name: "Z.AI",
    env: "ZHIPU_API_KEY",
    models: [
      { id: "glm-5.3", name: "GLM-5.3", baseURL: "https://api.z.ai/api/paas/v4", input: [] as never[] },
      { id: "glm-5.3-flash", name: "GLM-5.3-Flash", baseURL: "https://api.z.ai/api/paas/v4", input: ["image", "pdf"] as never[] },
    ],
  },
]

function setup() {
  const [state, setState] = createStore<AppState>({
    ...structuredClone(initialState), modelSettingsOpen: true,
    configuredModels: [{ id: "m1", name: "Fixture", providerID: "fixture", providerName: "Fixture", modelID: "vision", baseURL: "https://example.com/v1", apiKey: "fixture", inputModalities: ["image", "pdf"] }],
    selectedModelKey: "fixture/vision",
  })
  const client = { listProviders: vi.fn().mockResolvedValue({ all: [], default: {}, connected: [] }) } as unknown as AgentClient
  const models = createModelSlice({ state, setState, client }, { sync: vi.fn().mockResolvedValue(undefined), invalidate: vi.fn() })
  const container = document.createElement("div")
  document.body.append(container)
  const dispose = render(() => (
    <StoreProviders models={models} projects={{} as ProjectApi} runtime={{} as RuntimeApi} chrome={{} as ChromeApi}>
      <ModelSettings />
    </StoreProviders>
  ), container)
  return { state, models, container, dispose }
}

afterEach(() => {
  vi.mocked(modelCatalog).mockReset()
})

it("toggles a model's attachment capability from the capability pill", async () => {
  const { state, container, dispose } = setup()
  try {
    const pills = container.querySelectorAll<HTMLButtonElement>(".model-row .capability-pill")
    expect(pills).toHaveLength(4)
    expect(pills[0].classList.contains("on")).toBe(true)
    pills[0].click()
    await vi.waitFor(() => expect(state.configuredModels[0].inputModalities).toEqual(["pdf"]))
    expect(pills[3].disabled).toBe(true)
  } finally { dispose(); container.remove() }
})

it("adds a catalog provider's model with its real input capabilities", async () => {
  vi.mocked(modelCatalog).mockResolvedValue(catalog as never)
  const { state, container, dispose } = setup()
  try {
    ;[...container.querySelectorAll<HTMLButtonElement>(".settings-tab")].find((tab) => tab.textContent === "目录")!.click()
    await vi.waitFor(() => expect(container.querySelector(".catalog-provider")).toBeTruthy())
    container.querySelector<HTMLButtonElement>(".catalog-provider-head")!.click()
    const models = container.querySelectorAll<HTMLLabelElement>(".catalog-model")
    expect(models).toHaveLength(2)
    models[1].querySelector<HTMLInputElement>("input")!.click()
    const key = container.querySelector<HTMLInputElement>(".catalog-add-bar input")!
    key.value = "sk-zai"
    key.dispatchEvent(new Event("input", { bubbles: true }))
    container.querySelector<HTMLButtonElement>(".catalog-add-bar .send-btn")!.click()
    await vi.waitFor(() => {
      const added = state.configuredModels.find((item) => item.providerID === "zai" && item.modelID === "glm-5.3-flash")
      expect(added).toMatchObject({ providerName: "Z.AI", baseURL: "https://api.z.ai/api/paas/v4", apiKey: "sk-zai", inputModalities: ["image", "pdf"] })
      // The dialog closes once the backend sync promise resolves.
      expect(state.modelSettingsOpen).toBe(false)
    })
    expect(state.modelSettingsError).toBeNull()
  } finally { dispose(); container.remove() }
})

it("filters the catalog by provider and model name", async () => {
  vi.mocked(modelCatalog).mockResolvedValue([
    ...catalog,
    { id: "other", name: "Other Provider", models: [{ id: "unrelated", name: "Unrelated", baseURL: "https://other.example/v1", input: [] }] },
  ] as never)
  const { container, dispose } = setup()
  try {
    ;[...container.querySelectorAll<HTMLButtonElement>(".settings-tab")].find((tab) => tab.textContent === "目录")!.click()
    await vi.waitFor(() => expect(container.querySelectorAll(".catalog-provider")).toHaveLength(2))
    const search = container.querySelector<HTMLInputElement>(".catalog-search")!
    search.value = "glm-5.3-flash"
    search.dispatchEvent(new Event("input", { bubbles: true }))
    await vi.waitFor(() => {
      const shown = [...container.querySelectorAll(".catalog-provider-name")].map((node) => node.textContent)
      expect(shown).toEqual(["Z.AI"])
      // Searching auto-expands matches and filters the model rows.
      expect(container.querySelectorAll(".catalog-model")).toHaveLength(1)
    })
  } finally { dispose(); container.remove() }
})
