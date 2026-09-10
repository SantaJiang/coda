import { afterEach, describe, expect, it } from "vitest"
import { applyWindowChromeAttr, usesCustomWindowControls } from "./platform"

const originalPlatform = Object.getOwnPropertyDescriptor(navigator, "platform")
const originalUa = Object.getOwnPropertyDescriptor(navigator, "userAgent")

function stubNavigator(platform: string, userAgent: string) {
  Object.defineProperty(navigator, "platform", { configurable: true, value: platform })
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: userAgent })
}

function markTauri() {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} })
}

afterEach(() => {
  if (originalPlatform) Object.defineProperty(navigator, "platform", originalPlatform)
  if (originalUa) Object.defineProperty(navigator, "userAgent", originalUa)
  delete document.documentElement.dataset.chrome
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__")
})

describe("window chrome platform", () => {
  it("treats macOS as overlay, not custom controls", () => {
    stubNavigator("MacIntel", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")
    markTauri()
    expect(usesCustomWindowControls()).toBe(false)
    applyWindowChromeAttr()
    expect(document.documentElement.dataset.chrome).toBe("overlay")
  })

  it("shows custom controls only inside Tauri on non-mac", () => {
    stubNavigator("Win32", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
    expect(usesCustomWindowControls()).toBe(false)
    applyWindowChromeAttr()
    expect(document.documentElement.dataset.chrome).toBe("frameless")

    markTauri()
    expect(usesCustomWindowControls()).toBe(true)
  })
})
