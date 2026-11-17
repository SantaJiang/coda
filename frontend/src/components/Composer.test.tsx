import { afterEach, expect, it, vi } from "vitest"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import { StoreProviders } from "../store/ctx"
import type { ChromeApi, ModelApi, ProjectApi, RuntimeApi } from "../store/contracts"
import { inputFromMedia } from "../lib/model-input"
import type { ComposerAttachment } from "../lib/attachments"
import { Composer } from "./Composer"

const native = vi.hoisted(() => ({ active: false }))
vi.mock("../lib/platform-detect", () => ({ isTauri: () => native.active, isMacPlatform: () => false }))
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }) }))
vi.mock("./ComposerPlus", () => ({ ComposerPlus: () => <div /> }))
vi.mock("./ModelMenu", () => ({ ModelMenu: () => <div /> }))
vi.mock("./VariantMenu", () => ({ VariantMenu: () => <div /> }))
vi.mock("./PermissionMenu", () => ({ PermissionMenu: () => <div /> }))

const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); native.active = false })

function setup(importAttachments = vi.fn().mockResolvedValue(false), overrides: Partial<RuntimeApi> = {}, model: Record<string, unknown> = {}, chromeOverrides: Partial<ChromeApi> = {}) {
  const [text, setText] = createSignal("before after")
  const [session, setSession] = createSignal<string | null>("s1")
  const runtime = { composer: text, setComposer: setText, attachments: () => [], attachmentsLoading: () => false, blocked: () => false, stopping: () => false, busy: () => false, importAttachments, ...overrides } as unknown as RuntimeApi
  const container = document.createElement("div")
  document.body.append(container)
  const dispose = render(() => <StoreProviders runtime={runtime}
    projects={{ selectedProject: () => ({ id: "p1", path: "/tmp/app" }), selectedSessionId: session } as ProjectApi}
    models={{ selectedModel: () => ({ name: "text model", ...model }) } as ModelApi}
    chrome={{ overlayOpen: () => false, planMode: () => false, sendShortcut: () => "enter", ...chromeOverrides } as ChromeApi}><Composer /></StoreProviders>, container)
  cleanups.push(() => { dispose(); container.remove() })
  const area = container.querySelector("textarea")!
  const paste = (files: File[], text = "") => {
    const event = new Event("paste", { bubbles: true, cancelable: true })
    Object.defineProperty(event, "clipboardData", { value: { files, items: [], getData: () => text } })
    area.dispatchEvent(event)
    return event
  }
  return { area, container, paste, text, setText, setSession, importAttachments }
}

it("imports all pasted files and intercepts file drops", async () => {
  const { paste, container, importAttachments } = setup()
  const files = [new File(["{}"], "data.json", { type: "application/json" }), new File(["%PDF"], "report.pdf", { type: "application/pdf" })]
  expect(paste(files).defaultPrevented).toBe(true)
  expect(importAttachments).toHaveBeenCalledWith({ files })
  const event = new Event("drop", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "dataTransfer", { value: { files } })
  container.querySelector(".composer")!.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  expect(importAttachments).toHaveBeenCalledTimes(2)
})

it("leaves ordinary browser text paste to the browser", () => {
  const { paste, importAttachments } = setup()
  expect(paste([], "hello").defaultPrevented).toBe(false)
  expect(importAttachments).not.toHaveBeenCalled()
})

it("keeps the stop button usable while files are still being read", () => {
  const abort = vi.fn().mockResolvedValue(undefined)
  const { container, setText } = setup(undefined, { busy: () => true, attachmentsLoading: () => true, abort })
  setText("")
  const button = container.querySelector<HTMLButtonElement>(".send-btn")!
  expect(button.textContent).toBe("停止")
  expect(button.disabled).toBe(false)
  button.click()
  expect(abort).toHaveBeenCalledOnce()
})

it("warns about image attachments on text-input models but keeps them sendable", () => {
  const send = vi.fn().mockResolvedValue(undefined)
  const attachments: ComposerAttachment[] = [{ id: "att1", filename: "shot.png", mime: "image/png", kind: "file", url: "file:///tmp/shot.png", label: "PNG" }]
  const { container } = setup(undefined, { attachments: () => attachments, send }, { input: inputFromMedia([]) })
  const button = container.querySelector<HTMLButtonElement>(".send-btn")!
  expect(button.disabled).toBe(false)
  expect(container.querySelector(".attachment-notice.warning")?.textContent).toContain("图片")
  button.click()
  expect(send).toHaveBeenCalledOnce()
})

it("blocks sending media the compatible adapter cannot carry", () => {
  const send = vi.fn().mockResolvedValue(undefined)
  const attachments: ComposerAttachment[] = [{ id: "att1", filename: "clip.mp4", mime: "video/mp4", kind: "file", url: "file:///tmp/clip.mp4", label: "MP4" }]
  const { container } = setup(undefined, { attachments: () => attachments, send }, { input: inputFromMedia(["video"]) })
  const button = container.querySelector<HTMLButtonElement>(".send-btn")!
  expect(button.disabled).toBe(true)
  expect(container.querySelector(".attachment-notice.warning")?.textContent).toContain("无法发送")
  expect(send).not.toHaveBeenCalled()
})

it("does not stop a session for an Escape already consumed by a menu", () => {
  const abort = vi.fn()
  const { area } = setup(undefined, { busy: () => true, abort })
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
  event.preventDefault()
  area.dispatchEvent(event)
  expect(abort).not.toHaveBeenCalled()
})

it("falls back to native clipboard files then inserts plain text at the selected caret", async () => {
  native.active = true
  const { area, paste, text, importAttachments } = setup()
  area.focus()
  area.setSelectionRange(7, 7)
  expect(paste([], "中文").defaultPrevented).toBe(true)
  await vi.waitFor(() => expect(text()).toBe("before 中文after"))
  expect(importAttachments).toHaveBeenCalledWith({ clipboard: true, includeImage: false })
  expect(area.selectionStart).toBe(9)
})

it("does not paste Finder filenames as text and probes native images when there is no text", async () => {
  native.active = true
  const { paste, text, importAttachments } = setup(vi.fn().mockResolvedValue(true))
  paste([], "report.pdf")
  await Promise.resolve()
  expect(text()).toBe("before after")
  paste([])
  expect(importAttachments).toHaveBeenLastCalledWith({ clipboard: true, includeImage: true })
})

it("discards a delayed plain text fallback when the user switches sessions", async () => {
  native.active = true
  let resolve!: (value: boolean) => void
  const promise = new Promise<boolean>((yes) => { resolve = yes })
  const { paste, setSession, text } = setup(vi.fn(() => promise))
  paste([], "must not move")
  setSession("s2")
  resolve(false)
  await Promise.resolve()
  expect(text()).toBe("before after")
})

it("keeps focus in the textarea when the send button is pressed", () => {
  const { container } = setup()
  const button = container.querySelector<HTMLButtonElement>(".send-btn")!
  const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 })
  button.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
})

it("shows the active send shortcut only while there is something to send", async () => {
  const { container, setText } = setup()
  expect(container.querySelector(".composer-hint")?.textContent).toBe("Enter 发送")
  setText("")
  await Promise.resolve()
  expect(container.querySelector(".composer-hint")).toBeNull()
})

it("labels the configured send shortcut", () => {
  const { container } = setup(undefined, {}, {}, { sendShortcut: () => "mod-enter" })
  expect(container.querySelector(".composer-hint")?.textContent).toBe("Ctrl+Enter 发送")
})

it("says a draft sent while busy will queue", () => {
  const { container } = setup(undefined, { busy: () => true })
  expect(container.querySelector(".composer-hint")?.textContent).toBe("将加入队列")
})

it("holds the open height for a beat after the sent draft clears", async () => {
  const { area, container, setText } = setup(undefined, { send: vi.fn() })
  Object.defineProperty(area, "scrollHeight", { configurable: true, get: () => 120 })
  Object.defineProperty(area, "offsetHeight", { configurable: true, get: () => parseFloat(area.style.height) || 44 })
  area.value = "one\ntwo\nthree"
  area.dispatchEvent(new Event("input", { bubbles: true }))
  await Promise.resolve()
  expect(area.style.height).toBe("120px")
  container.querySelector<HTMLButtonElement>(".send-btn")!.click()
  setText("")
  await Promise.resolve()
  expect(area.style.height).toBe("120px")
  await new Promise<void>((resolve) => setTimeout(resolve, 80))
  expect(area.style.height).toBe("")
})

it("leaves the height alone when the draft survives the send", async () => {
  const { area, container } = setup(undefined, { send: vi.fn() })
  Object.defineProperty(area, "scrollHeight", { configurable: true, get: () => 120 })
  Object.defineProperty(area, "offsetHeight", { configurable: true, get: () => parseFloat(area.style.height) || 44 })
  area.value = "one\ntwo\nthree"
  area.dispatchEvent(new Event("input", { bubbles: true }))
  await Promise.resolve()
  container.querySelector<HTMLButtonElement>(".send-btn")!.click()
  await new Promise<void>((resolve) => setTimeout(resolve, 80))
  expect(area.style.height).toBe("120px")
})
