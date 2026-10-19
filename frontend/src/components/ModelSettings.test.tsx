import { expect, it, vi } from "vitest"
import { render } from "solid-js/web"
import { createStore } from "solid-js/store"
import { StoreProviders } from "../store/ctx"
import { createModelSlice } from "../store/model-slice"
import { initialState, type AppState } from "../store/state"
import type { AgentClient } from "../store/ports"
import type { ChromeApi, ProjectApi, RuntimeApi } from "../store/contracts"
import { ModelSettings } from "./ModelSettings"

it("retains the expanded capability editor when a checkbox replaces the model record", async () => {
  const [state, setState] = createStore<AppState>({ ...structuredClone(initialState), modelSettingsOpen: true,
    configuredModels: [{ id: "m1", name: "Fixture", providerID: "fixture", providerName: "Fixture", modelID: "vision", baseURL: "https://example.com/v1", apiKey: "fixture", inputModalities: ["image", "pdf"] }],
    selectedModelKey: "fixture/vision",
  })
  const client = { listProviders: vi.fn().mockResolvedValue({ all: [], default: {}, connected: [] }) } as unknown as AgentClient
  const models = createModelSlice({ state, setState, client }, { sync: vi.fn().mockResolvedValue(undefined), invalidate: vi.fn() })
  const container = document.createElement("div")
  document.body.append(container)
  const dispose = render(() => <StoreProviders models={models} projects={{} as ProjectApi} runtime={{} as RuntimeApi} chrome={{} as ChromeApi}><ModelSettings /></StoreProviders>, container)
  try {
    const details = container.querySelector<HTMLDetailsElement>(".model-input-settings")!
    details.open = true
    details.dispatchEvent(new Event("toggle"))
    container.querySelector<HTMLInputElement>(".model-input-options input")!.click()
    await vi.waitFor(() => expect(state.configuredModels[0].inputModalities).toEqual(["pdf"]))
    expect(container.querySelector<HTMLDetailsElement>(".model-input-settings")!.open).toBe(true)
    expect(container.querySelectorAll<HTMLInputElement>(".model-input-options input")[3].disabled).toBe(true)
  } finally { dispose(); container.remove() }
})
