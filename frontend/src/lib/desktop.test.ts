import { afterEach, expect, it, vi } from "vitest"
import { invoke } from "@tauri-apps/api/core"
import { openUrl } from "@tauri-apps/plugin-opener"
import { installNavigationGuard, installQuitShortcut } from "./desktop"

vi.mock("./platform", () => ({ isTauri: () => true }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }))
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

function anchorClick(href: string, type = "click") {
  const anchor = document.createElement("a")
  anchor.href = href
  document.body.appendChild(anchor)
  try {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true })
    anchor.dispatchEvent(event)
    return event
  } finally {
    anchor.remove()
  }
}

it("sends stream links to the system browser instead of navigating the window", async () => {
  const stop = installNavigationGuard()
  try {
    const event = anchorClick("https://example.com/report")
    expect(event.defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(openUrl).toHaveBeenCalledWith("https://example.com/report"))
  } finally {
    stop()
  }
})

it("routes middle clicks and window.open to the system browser too", async () => {
  const stop = installNavigationGuard()
  try {
    const middle = anchorClick("https://example.com/page", "auxclick")
    expect(middle.defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(openUrl).toHaveBeenCalledWith("https://example.com/page"))
    expect(window.open("https://example.com/popup")).toBeNull()
    await vi.waitFor(() => expect(openUrl).toHaveBeenCalledWith("https://example.com/popup"))
  } finally {
    stop()
  }
})

it("blocks dangerous protocols without opening anything", () => {
  const stop = installNavigationGuard()
  try {
    const event = anchorClick("javascript:alert(1)")
    expect(event.defaultPrevented).toBe(true)
    expect(openUrl).not.toHaveBeenCalled()
  } finally {
    stop()
  }
})

it("leaves the frontend's own pages and export downloads alone", () => {
  const stop = installNavigationGuard()
  try {
    const internal = anchorClick(`${location.origin}/settings`)
    expect(internal.defaultPrevented).toBe(false)
    const exported = anchorClick("blob:http://localhost/6c6f-7072")
    expect(exported.defaultPrevented).toBe(false)
    expect(openUrl).not.toHaveBeenCalled()
  } finally {
    stop()
  }
})
