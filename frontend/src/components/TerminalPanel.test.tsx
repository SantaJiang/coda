import { render } from "solid-js/web"
import { createSignal } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"
import TerminalPanel, { TerminalOutput } from "./TerminalPanel"
import type { TerminalClient } from "../lib/terminal-client"
import type { TerminalLog } from "../lib/terminal-contracts"
import type { TerminalInfo } from "../lib/api"
import type { Terminals } from "../lib/terminals"

const mocked = vi.hoisted(() => ({ instances: [] as any[], action: vi.fn() }))
vi.mock("../store/theme", () => ({
  useTheme: () => ({ theme: () => "light" }),
}))
vi.mock("../lib/api", async (original) => ({
  ...(await original<typeof import("../lib/api")>()),
  terminalLog: vi.fn().mockResolvedValue({
    data: "5L2g5aW9",
    start: 0,
    cursor: 6,
    baseCursor: 0,
    endCursor: 6,
    truncated: false,
    status: "running",
  }),
  terminalStreamURL: () => "http://localhost/terminal-stream",
}))
vi.mock("ghostty-web", () => ({
  Ghostty: { load: async () => ({}) },
  FitAddon: class {
    fit() {}
  },
  Terminal: class {
    options: any
    textarea = document.createElement("textarea")
    buffer = {
      active: {
        length: 1,
        getLine: () => ({ translateToString: () => "你好" }),
      },
    }
    selectAll = vi.fn()
    copySelection = vi.fn()
    keyHandler?: (event: KeyboardEvent) => boolean
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
      this.keyHandler = handler
    }
    viewport = 0
    scrollback = 0
    scrollHandler?: () => void
    write = vi.fn((text: string) => {
      this.scrollback += text.split("\n").length - 1
      this.scrollToBottom()
    })
    dispose = vi.fn()
    constructor(options: any) {
      this.options = options
      mocked.instances.push(this)
    }
    open(host: HTMLElement) {
      host.append(this.textarea)
      this.focus()
      setTimeout(() => this.focus(), 0)
    }
    focus = vi.fn(() => this.textarea.focus())
    blur() {}
    loadAddon() {}
    getViewportY() { return this.viewport }
    getScrollbackLength() { return this.scrollback }
    scrollToLine(value: number) { this.viewport = value; this.scrollHandler?.() }
    scrollToBottom() { if (this.viewport) this.scrollToLine(0) }
    scrollToTop() { this.scrollToLine(this.scrollback) }
    scrollLines(value: number) { this.scrollToLine(Math.max(0, this.viewport - value)) }
    reset = vi.fn(() => { this.scrollback = 0; this.scrollToBottom() })
    onScroll(handler: () => void) {
      this.scrollHandler = handler
      return { dispose() {} }
    }
    getSelection() {
      return ""
    }
  },
}))
let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  document.body.replaceChildren()
  mocked.instances.length = 0
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it("supports terminal selection shortcuts without input, metadata or toolbar buttons", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response('data: {"data":"","cursor":6,"baseCursor":0,"start":6,"endCursor":6,"truncated":false,"status":"completed","ended":true}\n\n')),
  )
  const info: TerminalInfo = {
    id: "first",
    sessionID: "one",
    rootSessionID: "one",
    command: "bun install",
    cwd: "/private/project",
    startedAt: Date.now(),
    lastOutputAt: Date.now(),
    status: "running",
    cursor: 6,
    baseCursor: 0,
  }
  const [selected, setSelected] = createSignal("first")
  const items = [info, { ...info, id: "second", command: "bun test" }]
  const model = {
    visible: () => items,
    selected: () => items.find((item) => item.id === selected()),
    view: () => ({ scroll: {} }),
    patch: (value: { selected?: string }) => value.selected && setSelected(value.selected),
    action: mocked.action,
    error: () => "",
  } as unknown as Terminals
  const host = document.createElement("div")
  document.body.append(host)
  const composer = document.createElement("textarea")
  document.body.append(composer)
  composer.focus()
  cleanup = render(() => <TerminalPanel terminals={model} directory="/private/project" sessionID="one" />, host)
  await vi.waitFor(() => expect(mocked.instances).toHaveLength(1))
  const terminal = mocked.instances[0]
  expect(terminal.options.disableStdin).toBe(true)
  expect(terminal.textarea.readOnly).toBe(true)
  expect(terminal.textarea.tabIndex).toBe(-1)
  expect(host.querySelector('[role="log"]')?.getAttribute("contenteditable")).toBe("false")
  await vi.waitFor(() => expect(terminal.write).toHaveBeenCalledWith("你好"))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(document.activeElement).toBe(composer)
  expect(terminal.write).not.toHaveBeenCalledWith("")
  expect(host.textContent).not.toMatch(/private\/project|exit |搜索|查找|停止命令|复制/)
  expect(host.querySelector("input")).toBeNull()
  const buttons = [...host.querySelectorAll("button")]
  expect(terminal.keyHandler(new KeyboardEvent("keydown", { key: "a", metaKey: true }))).toBe(true)
  expect(terminal.selectAll).toHaveBeenCalledOnce()
  expect(terminal.keyHandler(new KeyboardEvent("keydown", { key: "c", ctrlKey: true }))).toBe(true)
  expect(terminal.copySelection).toHaveBeenCalledOnce()
  expect(terminal.keyHandler(new KeyboardEvent("keydown", { key: "v", metaKey: true }))).toBe(true)
  expect(terminal.keyHandler(new KeyboardEvent("keydown", { key: "x" }))).toBe(false)
  buttons.find((button) => button.textContent?.includes("bun test"))!.click()
  expect(selected()).toBe("second")
  expect(terminal.dispose).toHaveBeenCalled()
})

it("shows a silent command explicitly and replaces the notice when streamed output arrives", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} })
  let emit!: (frame: TerminalLog) => void
  const client = {
    log: vi.fn().mockResolvedValue({ data: "", start: 0, cursor: 0, baseCursor: 0, endCursor: 0, truncated: false, status: "running" }),
    subscribe: vi.fn((_dir, _session, _id, _cursor, onFrame) => { emit = onFrame; return () => {} }),
  } as unknown as TerminalClient
  const host = document.createElement("div")
  document.body.append(host)
  const info: TerminalInfo = { id: "silent", sessionID: "one", rootSessionID: "one", command: "curl -sL https://example.test/file", cwd: "/tmp", startedAt: 1, lastOutputAt: 1, status: "running", cursor: 0, baseCursor: 0 }
  cleanup = render(() => <TerminalOutput client={client} directory="/tmp" sessionID="one" info={info} scroll={0} onScroll={() => {}} />, host)
  await vi.waitFor(() => expect(host.textContent).toContain("暂未产生输出"))
  expect(host.querySelector(".terminal-command")?.textContent).toBe(`$ ${info.command}`)
  emit({ data: btoa("download complete\r\n"), start: 0, cursor: 19, baseCursor: 0, endCursor: 19, truncated: false, status: "completed", ended: true })
  expect(mocked.instances[0].write).toHaveBeenCalledWith("download complete\r\n")
  expect(host.textContent).not.toContain("暂未产生输出")
})

it("keeps the inspected buffer line when Ghostty auto-scrolls on incoming output", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} })
  let emit!: (frame: TerminalLog) => void
  const frame = (text: string): TerminalLog => ({ data: btoa(text), start: 0, cursor: text.length, baseCursor: 0, endCursor: text.length, truncated: false, status: "running" })
  const client = {
    log: vi.fn().mockResolvedValue(frame("line\r\n".repeat(200))),
    subscribe: vi.fn((_d, _s, _id, _at, onFrame) => { emit = onFrame; return () => {} }),
  } as unknown as TerminalClient
  const host = document.createElement("div")
  document.body.append(host)
  const info = { id: "stream", status: "running", command: "build", cursor: 1 } as TerminalInfo
  const onScroll = vi.fn()
  cleanup = render(() => <TerminalOutput client={client} directory="/tmp" sessionID="one" info={info} scroll={0} onScroll={onScroll} />, host)
  await vi.waitFor(() => expect(client.subscribe).toHaveBeenCalledOnce())
  const terminal = mocked.instances[0]
  terminal.scrollToLine(80)
  expect(host.querySelector(".terminal-follow")).not.toBeNull()
  emit(frame("next line\r\nanother line\r\n"))
  expect(terminal.getViewportY()).toBe(82)
  expect(onScroll).toHaveBeenLastCalledWith(82)
  expect(host.querySelector(".terminal-follow")).not.toBeNull()
})
