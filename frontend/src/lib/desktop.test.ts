import { afterEach, expect, it, vi } from "vitest"
import { invoke } from "@tauri-apps/api/core"
import { installQuitShortcut } from "./desktop"

vi.mock("./platform", () => ({ isTauri: () => true }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it("routes macOS Cmd+Q to native shutdown before a terminal can consume the key", async () => {
  vi.stubGlobal("navigator", { platform: "MacIntel" })
  const stop = installQuitShortcut()
  const terminalKey = vi.fn()
  document.body.addEventListener("keydown", terminalKey)
  try {
    const event = new KeyboardEvent("keydown", { key: "q", metaKey: true, bubbles: true, cancelable: true })
    document.body.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(terminalKey).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("desktop_quit"))
    stop()
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "q", metaKey: true, bubbles: true }))
    expect(invoke).toHaveBeenCalledTimes(1)
  } finally {
    stop()
    document.body.removeEventListener("keydown", terminalKey)
  }
})
