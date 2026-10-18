import { render } from "solid-js/web"
import { createSignal } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"
import TerminalPanel from "./TerminalPanel"
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
    write = vi.fn()
    dispose = vi.fn()
    constructor(options: any) {
      this.options = options
      mocked.instances.push(this)
    }
    open(host: HTMLElement) {
      host.append(this.textarea)
    }
    blur() {}
    loadAddon() {}
    scrollToBottom() {}
    scrollLines() {}
    onScroll() {
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
  cleanup = render(() => <TerminalPanel terminals={model} directory="/private/project" sessionID="one" />, host)
  await vi.waitFor(() => expect(mocked.instances).toHaveLength(1))
  const terminal = mocked.instances[0]
  expect(terminal.options.disableStdin).toBe(true)
  expect(terminal.textarea.readOnly).toBe(true)
  expect(terminal.textarea.tabIndex).toBe(-1)
  expect(host.querySelector('[role="log"]')?.getAttribute("contenteditable")).toBe("false")
  await vi.waitFor(() => expect(terminal.write).toHaveBeenCalledWith("你好"))
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
