import { render } from "solid-js/web"
import { createSignal } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useTerminals, isLongTerminal, LONG_TERMINAL_MS } from "./terminals"
import { listTerminals, terminalLog, terminalControl, type TerminalInfo } from "./api"

vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  listTerminals: vi.fn(),
  terminalControl: vi.fn(),
}))
const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.useRealTimers()
  vi.restoreAllMocks()
  localStorage.clear()
})
const task = (id: string): TerminalInfo => ({
  id,
  sessionID: "one",
  rootSessionID: "one",
  command: "bun install",
  cwd: "/tmp/project",
  startedAt: Date.now() - LONG_TERMINAL_MS - 1000,
  lastOutputAt: Date.now(),
  status: "running",
  cursor: 0,
  baseCursor: 0,
})
const flush = () => new Promise<void>((resolve) => queueMicrotask(() => queueMicrotask(resolve)))

describe("session terminal ownership", () => {
  it("does not auto-open on launch, and closing the panel preserves the running terminal", async () => {
    vi.mocked(listTerminals).mockResolvedValue({
      backendID: "backend",
      items: [task("first")],
    })
    let model!: ReturnType<typeof useTerminals>
    const host = document.createElement("div")
    cleanups.push(
      render(() => {
        model = useTerminals(
          () => "/tmp/terminal-one",
          () => "one",
        )
        return null
      }, host),
    )
    await flush()
    expect(model.visible()).toHaveLength(1)
    expect(model.view().open).toBe(false)
    model.open("first")
    expect(model.view().open).toBe(true)
    model.patch({ open: false })
    expect(model.visible()[0]?.status).toBe("running")
  })
  it("does not apply a late response from the previously selected session", async () => {
    let resolveOld!: (value: Awaited<ReturnType<typeof listTerminals>>) => void
    const old = new Promise<Awaited<ReturnType<typeof listTerminals>>>((resolve) => {
      resolveOld = resolve
    })
    vi.mocked(listTerminals).mockImplementation((_dir, id) =>
      id === "one" ? old : Promise.resolve({ backendID: "backend", items: [task("second")] }),
    )
    const [session, setSession] = createSignal("one")
    let model!: ReturnType<typeof useTerminals>
    cleanups.push(
      render(() => {
        model = useTerminals(() => "/tmp/terminal-two", session)
        return null
      }, document.createElement("div")),
    )
    await flush()
    setSession("two")
    await flush()
    resolveOld({ backendID: "backend", items: [task("wrong")] })
    await flush()
    expect(model.visible().map((item) => item.id)).toEqual(["second"])
  })
  it("reveals a removed completed terminal again from its historical execution step", async () => {
    const hidden = { ...task("hidden"), status: "completed" as const, hidden: true }
    vi.mocked(listTerminals).mockResolvedValue({ backendID: "backend", items: [hidden] })
    let model!: ReturnType<typeof useTerminals>
    cleanups.push(
      render(() => {
        model = useTerminals(
          () => "/tmp/terminal-history",
          () => "one",
        )
        return null
      }, document.createElement("div")),
    )
    await flush()
    expect(model.visible()).toHaveLength(0)
    vi.mocked(listTerminals).mockResolvedValue({ backendID: "backend", items: [{ ...hidden, hidden: false }] })
    window.dispatchEvent(new CustomEvent("coda:open-terminal", { detail: "hidden" }))
    await flush()
    expect(terminalControl).toHaveBeenCalledWith("/tmp/terminal-history", "one", "hidden", "show")
    expect(model.selected()?.id).toBe("hidden")
    expect(model.view().open).toBe(true)
  })
})
describe("terminal output response", () => {
  it("preserves a log payload with a data field instead of unwrapping it as an API envelope", async () => {
    const frame = {
      data: "5L2g5aW9",
      start: 0,
      cursor: 6,
      baseCursor: 0,
      endCursor: 6,
      truncated: false,
      status: "running",
    }
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(frame), {
          headers: { "content-type": "application/json" },
        }),
      ),
    )
    expect(await terminalLog("/tmp/project", "one", "first")).toEqual(frame)
    vi.unstubAllGlobals()
  })
})


describe("long terminal visibility", () => {
  it("does not promote fast commands, and keeps completed long commands visible", () => {
    const start = 1_000_000
    const info = { ...task("time"), startedAt: start }
    expect(isLongTerminal(info, start + 9999)).toBe(false)
    expect(isLongTerminal(info, start + 10000)).toBe(true)
    expect(isLongTerminal({ ...info, endedAt: start + 500 }, start + 100000)).toBe(false)
    expect(isLongTerminal({ ...info, endedAt: start + 15000 }, start + 100000)).toBe(true)
  })
  it("promotes a command only after it has actually kept running for ten seconds", async () => {
    vi.useFakeTimers()
    const info = { ...task("becomes-long"), startedAt: Date.now(), nextCheckAt: Date.now() + 30000 }
    vi.mocked(listTerminals).mockResolvedValue({ backendID: "backend", items: [info] })
    let model!: ReturnType<typeof useTerminals>
    cleanups.push(render(() => { model = useTerminals(() => "/tmp/promote-long", () => "one"); return null }, document.createElement("div")))
    await flush()
    expect(model.visible()).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(9999)
    expect(model.visible()).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(251)
    expect(model.visible().map((info) => info.id)).toEqual(["becomes-long"])
    expect(model.waiting()?.id).toBe("becomes-long")
    expect(model.view().open).toBe(false)
  })
  it("omits a history of short commands from both the panel and countdown", async () => {
    const start = Date.now()
    const short = Array.from({ length: 30 }, (_, i) => ({ ...task(String(i)), status: "completed" as const, startedAt: start - 1000, endedAt: start - 900 }))
    vi.mocked(listTerminals).mockResolvedValue({ backendID: "backend", items: short })
    let model!: ReturnType<typeof useTerminals>
    cleanups.push(render(() => { model = useTerminals(() => "/tmp/short-history", () => "one"); return null }, document.createElement("div")))
    await flush()
    expect(model.items()).toHaveLength(30)
    expect(model.visible()).toHaveLength(0)
    expect(model.waiting()).toBeUndefined()
  })
})
