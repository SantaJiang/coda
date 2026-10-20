import { render } from "solid-js/web"
import { Show, createSignal, onCleanup } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { defaultTerminalClient } from "./terminal-client"
import { useTerminals, isLongTerminal, LONG_TERMINAL_MS } from "./terminals"
import { listTerminals, terminalLog, terminalControl, type TerminalInfo } from "./api"

vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  listTerminals: vi.fn(),
  terminalControl: vi.fn(),
}))
const cleanups: (() => void)[] = []
beforeEach(() => vi.spyOn(defaultTerminalClient, "log").mockResolvedValue({ data: btoa("real output"), start: 0, cursor: 11, baseCursor: 0, endCursor: 11, truncated: false, status: "running" }))
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
  cursor: 1,
  baseCursor: 0,
})
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

describe("session terminal ownership", () => {
  it("keeps an open terminal mounted when stop/send refreshes the same session metadata", async () => {
    vi.mocked(listTerminals).mockResolvedValue({ backendID: "backend", items: [task("stable")] })
    const [session, setSession] = createSignal({ id: "one", updated: 1 })
    const [project, setProject] = createSignal({ path: "/tmp/stable-panel", updated: 1 })
    let model!: ReturnType<typeof useTerminals>
    let mounts = 0, unmounts = 0
    const Panel = () => { mounts++; onCleanup(() => unmounts++); return <div /> }
    cleanups.push(render(() => {
      model = useTerminals(() => project().path, () => session().id)
      return <Show when={model.view().open && model.visible().length > 0}><Panel /></Show>
    }, document.createElement("div")))
    await flush()
    model.open("stable")
    const items = model.items()
    const requests = vi.mocked(listTerminals).mock.calls.length
    setSession({ id: "one", updated: 2 })
    setProject({ path: "/tmp/stable-panel", updated: 2 })
    expect(model.items()).toBe(items)
    expect(model.selected()?.id).toBe("stable")
    expect(model.view().open).toBe(true)
    expect(mounts).toBe(1)
    expect(unmounts).toBe(0)
    expect(vi.mocked(listTerminals).mock.calls.length).toBe(requests)
  })
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
  it("omits silent tasks from the dock and rejects direct viewer requests until real output arrives", async () => {
    vi.useFakeTimers()
    const silent = { ...task("silent"), cursor: 2 }
    vi.mocked(defaultTerminalClient.log).mockResolvedValue({ data: btoa("\r\n"), start: 0, cursor: 2, baseCursor: 0, endCursor: 2, truncated: false, status: "running" })
    vi.mocked(listTerminals).mockResolvedValue({ backendID: "backend", items: [silent] })
    let model!: ReturnType<typeof useTerminals>
    cleanups.push(render(() => { model = useTerminals(() => "/tmp/silent", () => "one"); return null }, document.createElement("div")))
    await flush()
    expect(model.visible()).toEqual([])
    model.open("silent")
    window.dispatchEvent(new CustomEvent("coda:open-terminal", { detail: "silent" }))
    expect(model.view().open).toBe(false)
    vi.mocked(defaultTerminalClient.log).mockResolvedValue({ data: btoa("progress"), start: 2, cursor: 12, baseCursor: 0, endCursor: 12, truncated: false, status: "running" })
    vi.mocked(listTerminals).mockResolvedValue({ backendID: "backend", items: [{ ...silent, cursor: 12 }] })
    await vi.advanceTimersByTimeAsync(1000)
    expect(model.visible().map((info) => info.id)).toEqual(["silent"])
    expect(model.view().open).toBe(false)
    model.open("silent")
    expect(model.view().open).toBe(true)
  })
  it("keeps the inspected terminal selected when another command becomes the running task", async () => {
    vi.useFakeTimers()
    const first = task("inspected"), second = task("new-task")
    vi.mocked(listTerminals).mockResolvedValue({ backendID: "backend", items: [first] })
    let model!: ReturnType<typeof useTerminals>
    cleanups.push(render(() => { model = useTerminals(() => "/tmp/selected-stable", () => "one"); return null }, document.createElement("div")))
    await flush()
    expect(model.selected()?.id).toBe("inspected")
    vi.mocked(listTerminals).mockResolvedValue({ backendID: "backend", items: [{ ...first, status: "completed", endedAt: Date.now() }, second] })
    await vi.advanceTimersByTimeAsync(1000)
    expect(model.selected()?.id).toBe("inspected")
    model.open("new-task")
    expect(model.selected()?.id).toBe("new-task")
  })
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
