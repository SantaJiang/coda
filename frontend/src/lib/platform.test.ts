import { afterEach, describe, expect, it } from "vitest"
import { applyWindowChromeAttr, isWindowsPlatform, revealMainWindow, usesCustomWindowControls } from "./platform"
import windowCapabilities from "../../src-tauri/capabilities/default.json"

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
  it("grants the main window permissions needed to reveal the Windows shell", () => {
    expect(windowCapabilities.windows).toContain("main")
    expect(windowCapabilities.permissions).toEqual(expect.arrayContaining([
      "core:window:allow-show",
      "core:window:allow-set-shadow",
      "core:window:allow-set-focus",
    ]))
  })

  it("treats macOS as overlay, not custom controls", () => {
    stubNavigator("MacIntel", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")
    markTauri()
    expect(usesCustomWindowControls()).toBe(false)
    applyWindowChromeAttr()
    expect(document.documentElement.dataset.chrome).toBe("overlay")
  })

  it("detects Windows without treating other desktops as Windows", () => {
    stubNavigator("Win32", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
    expect(isWindowsPlatform()).toBe(true)
    stubNavigator("MacIntel", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")
    expect(isWindowsPlatform()).toBe(false)
    stubNavigator("Linux x86_64", "Mozilla/5.0 (X11; Linux x86_64)")
    expect(isWindowsPlatform()).toBe(false)
  })

  it("leaves non-Windows windows alone when revealing the shell", async () => {
    stubNavigator("MacIntel", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")
    markTauri()
    await revealMainWindow()
    stubNavigator("Win32", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__")
    await revealMainWindow()
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
