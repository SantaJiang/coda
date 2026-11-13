import { afterEach, describe, expect, it } from "vitest"
import { applyWindowMaterial, isWindowMaterial, markWindowMaterial } from "./window-effects"

afterEach(() => {
  delete document.documentElement.dataset.windowMaterial
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__")
})

describe("window material", () => {
  it("accepts only the materials the native side reports", () => {
    expect(isWindowMaterial("glass")).toBe(true)
    expect(isWindowMaterial("mica")).toBe(true)
    expect(isWindowMaterial("solid")).toBe(true)
    expect(isWindowMaterial("acrylic")).toBe(false)
    expect(isWindowMaterial(1)).toBe(false)
  })

  it("marks the document and keeps the solid palette outside Tauri", async () => {
    markWindowMaterial("glass")
    expect(document.documentElement.dataset.windowMaterial).toBe("glass")

    await expect(applyWindowMaterial("dark")).resolves.toBe("solid")
    expect(document.documentElement.dataset.windowMaterial).toBe("solid")
  })
})
