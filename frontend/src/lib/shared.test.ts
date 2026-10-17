import { describe, expect, it } from "vitest"
import { mergeForWrite, mergeHydrated, stripRetiredSettings, type SharedSettings } from "./shared"

const seed: SharedSettings = {
  models: [{ id: "m1", name: "M", providerID: "p", providerName: "P", modelID: "m", baseURL: "u", apiKey: "k" }],
  theme: "dark",
  projects: [{ id: "prj_1", path: "/tmp/a", name: "a", expanded: true }],
}

describe("mergeHydrated", () => {
  it("keeps memory empty and skips writing for a fresh instance without a file", () => {
    const result = mergeHydrated(null, { theme: "dark", models: [], projects: [] })
    expect(result.memory).toBeNull()
    expect(result.shouldWrite).toBe(false)
  })

  it("seeds the file from local storage when no file exists yet", () => {
    const result = mergeHydrated(null, seed)
    expect(result.memory).toEqual(seed)
    expect(result.shouldWrite).toBe(true)
  })

  it("prefers file values and keeps seed values for keys missing from the file", () => {
    const result = mergeHydrated({ theme: "light" }, seed)
    expect(result.memory).toEqual({ ...seed, theme: "light" })
    expect(result.shouldWrite).toBe(false)
  })

  it("lets an explicit empty list in the file win over seeded values", () => {
    const result = mergeHydrated({ models: [], projects: [] }, seed)
    expect(result.memory?.models).toEqual([])
    expect(result.memory?.projects).toEqual([])
    expect(result.memory?.theme).toBe("dark")
  })
})

describe("mergeForWrite", () => {
  it("writes the full memory when the file does not exist yet", () => {
    expect(mergeForWrite(null, { theme: "dark" }, ["theme"])).toEqual({ theme: "dark" })
  })

  it("only overlays dirty keys onto the latest file so other instances survive", () => {
    const file: SharedSettings = { theme: "light", sendShortcut: "mod-enter", stopBehavior: "ai" }
    const merged = mergeForWrite(file, { theme: "dark", sendShortcut: "enter" }, ["theme"])
    expect(merged).toEqual({ theme: "dark", sendShortcut: "mod-enter", stopBehavior: "ai" })
  })

  it("removes keys deleted locally", () => {
    const file: SharedSettings = { theme: "light", selectedModelKey: "a/b" }
    const merged = mergeForWrite(file, { theme: "light" }, ["selectedModelKey"])
    expect(merged).toEqual({ theme: "light" })
  })
})

describe("stripRetiredSettings", () => {
  it("drops the retired pinned-models key from an old settings file", () => {
    const file = { theme: "light", pinnedModelKeys: ["opencode/big-pickle"], keepBackendAlive: true } as unknown as SharedSettings
    const stripped = stripRetiredSettings(file)
    expect(stripped).toEqual({ theme: "light" })
    expect(stripped).not.toHaveProperty("pinnedModelKeys")
    expect(stripped).not.toHaveProperty("keepBackendAlive")
  })

  it("leaves a current settings file untouched", () => {
    expect(stripRetiredSettings(seed)).toEqual(seed)
  })
})
