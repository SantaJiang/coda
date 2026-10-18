import { expect, it, vi } from "vitest"
import { createStore } from "solid-js/store"
import { createBackendBootstrap, createBackendConfigSync } from "./backend-config"
import { initialState } from "./state"

it("retries initialization after health succeeds but configuration fails", async () => {
  const initialize = vi.fn().mockRejectedValueOnce(new Error("config offline")).mockResolvedValue(undefined)
  const onError = vi.fn()
  const bootstrap = createBackendBootstrap({ healthcheck: async () => true, initialize, onError })
  expect(await bootstrap.ensure()).toBe(false)
  expect(await bootstrap.ensure()).toBe(true)
  expect(await bootstrap.ensure()).toBe(true)
  expect(initialize).toHaveBeenCalledTimes(2)
  expect(onError).toHaveBeenCalledTimes(1)
  bootstrap.invalidate()
  expect(await bootstrap.ensure()).toBe(true)
  expect(initialize).toHaveBeenCalledTimes(3)
})

it("serializes writes and applies the latest config after an overlapping edit", async () => {
  let release!: () => void
  const first = new Promise<void>((resolve) => {
    release = resolve
  })
  const patchGlobalConfig = vi.fn().mockReturnValueOnce(first).mockResolvedValue(undefined)
  const [state, setState] = createStore({
    ...structuredClone(initialState),
    configuredModels: [
      {
        id: "m",
        providerID: "p",
        providerName: "p",
        modelID: "one",
        name: "one",
        baseURL: "https://example.test",
        apiKey: "fixture",
      },
    ],
    selectedModelKey: "p/one",
  })
  const config = createBackendConfigSync({ state, client: { patchGlobalConfig } })
  const pending = config.sync()
  setState("configuredModels", 0, "name", "new label")
  const newer = config.sync()
  release()
  await Promise.all([pending, newer])
  expect(patchGlobalConfig).toHaveBeenCalledTimes(2)
  expect(patchGlobalConfig.mock.calls[1][0].provider.p.models.one.name).toBe("new label")
  await config.sync()
  expect(patchGlobalConfig).toHaveBeenCalledTimes(2)
  config.invalidate()
  await config.sync()
  expect(patchGlobalConfig).toHaveBeenCalledTimes(3)
})
