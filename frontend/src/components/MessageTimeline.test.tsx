import { afterEach, expect, it, vi } from "vitest"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import { StoreProviders } from "../store/ctx"
import type { ChromeApi, ModelApi, ProjectApi, RuntimeApi } from "../store/contracts"
import { emptyTimelineView, type TimelineViewState } from "../lib/conversation"
import { MessageTimeline } from "./MessageTimeline"

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it("preserves the reading anchor when a layout-generated scroll arrives before ResizeObserver correction", () => {
  let layoutShift = 0
  let frame: FrameRequestCallback | undefined
  let resize!: ResizeObserverCallback
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1 })
  vi.stubGlobal("cancelAnimationFrame", () => { frame = undefined })
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { resize = callback }
    observe() {}
    disconnect() {}
  })
  const original = HTMLElement.prototype.getBoundingClientRect
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (!this.hasAttribute("data-entry-key")) return original.call(this)
    const top = 100 + layoutShift - this.closest(".timeline")!.scrollTop
    return { top, bottom: top + 1000, left: 0, right: 700, width: 700, height: 1000, x: 0, y: top, toJSON() {} }
  })
  const [view, setView] = createSignal(emptyTimelineView())
  const runtime = {
    timelineView: view, updateTimelineView: (patch: Partial<TimelineViewState>) => setView({ ...view(), ...patch }),
    messages: () => [
      { id: "u1", sessionID: "s1", role: "user", time: { created: 1 } },
      { id: "a1", sessionID: "s1", role: "assistant", parentID: "u1", time: { created: 2 } },
    ],
    partsByMessage: () => ({ a1: [{ id: "p1", type: "text", text: "streaming text", messageID: "a1", sessionID: "s1" }] }),
    status: () => ({ type: "busy" }), busy: () => true, stopping: () => false, settling: () => false,
    stoppedTurnID: () => undefined, stoppedTurns: () => ({}), pendingPermissions: () => [], pendingQuestions: () => [],
    sessionError: () => "", syncError: () => "",
  } as unknown as RuntimeApi
  const container = document.createElement("div")
  document.body.append(container)
  const dispose = render(() => <StoreProviders runtime={runtime} projects={{ selectedSessionId: () => "s1", connection: () => "connected" } as ProjectApi}
    models={{ nameFor: () => "model" } as ModelApi} chrome={{} as ChromeApi}><MessageTimeline /></StoreProviders>, container)
  try {
    const scroller = container.querySelector<HTMLDivElement>(".timeline")!
    Object.defineProperties(scroller, { scrollHeight: { value: 1200 }, clientHeight: { value: 200 } })
    scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true }))
    scroller.scrollTop = 400
    scroller.dispatchEvent(new Event("scroll"))
    expect(view().following).toBe(false)
    // Browser clamps/adjusts the position after content changes, before our RAF.
    layoutShift = 100
    scroller.scrollTop = 450
    scroller.dispatchEvent(new Event("scroll"))
    resize([], {} as ResizeObserver)
    frame?.(0)
    expect(scroller.scrollTop).toBe(500)
    expect(view().following).toBe(false)
    scroller.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }))
    scroller.scrollTop = 420
    scroller.dispatchEvent(new Event("scroll"))
    scroller.scrollTop = 350
    scroller.dispatchEvent(new Event("scroll"))
    document.dispatchEvent(new MouseEvent("pointerup"))
    layoutShift = 150
    scroller.scrollTop = 375
    scroller.dispatchEvent(new Event("scroll"))
    resize([], {} as ResizeObserver)
    frame?.(0)
    expect(scroller.scrollTop).toBe(400)
  } finally { dispose(); container.remove() }
})

it("restores a historical reading position after delayed session details arrive", () => {
  let resize!: ResizeObserverCallback
  vi.stubGlobal("requestAnimationFrame", () => 1)
  vi.stubGlobal("cancelAnimationFrame", () => {})
  vi.stubGlobal("ResizeObserver", class { constructor(callback: ResizeObserverCallback) { resize = callback } observe() {} disconnect() {} })
  const [messages, setMessages] = createSignal<import("../lib/types").Message[]>([])
  const [view, setView] = createSignal({ ...emptyTimelineView(), following: false, top: 400 })
  const runtime = {
    timelineView: view, updateTimelineView: (patch: Partial<TimelineViewState>) => setView({ ...view(), ...patch }),
    messages, partsByMessage: () => ({}), status: () => ({ type: "idle" }), busy: () => false, stopping: () => false,
    settling: () => false, stoppedTurnID: () => undefined, stoppedTurns: () => ({}),
    pendingPermissions: () => [], pendingQuestions: () => [], sessionError: () => "", syncError: () => "",
  } as unknown as RuntimeApi
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(() => <StoreProviders runtime={runtime} projects={{ selectedSessionId: () => "history", connection: () => "connected" } as ProjectApi}
    models={{ nameFor: () => "model" } as ModelApi} chrome={{} as ChromeApi}><MessageTimeline /></StoreProviders>, host)
  try {
    const scroller = host.querySelector<HTMLDivElement>(".timeline")!
    expect(view().top).toBe(400)
    resize([], {} as ResizeObserver)
    expect(view().top).toBe(400)
    setMessages([{ id: "user", role: "user", sessionID: "history", time: { created: 1 } }])
    Object.defineProperties(scroller, { scrollHeight: { value: 1200 }, clientHeight: { value: 200 } })
    resize([], {} as ResizeObserver)
    expect(scroller.scrollTop).toBe(400)
    expect(view().top).toBe(400)
    expect(view().following).toBe(false)
  } finally { dispose(); host.remove() }
})

it("keeps Worked for and earlier content fixed when an unfocused summary expands or collapses", () => {
  let resize!: ResizeObserverCallback
  vi.stubGlobal("requestAnimationFrame", () => 1)
  vi.stubGlobal("cancelAnimationFrame", () => {})
  vi.stubGlobal("ResizeObserver", class { constructor(callback: ResizeObserverCallback) { resize = callback } observe() {} disconnect() {} })
  const [view, setView] = createSignal({ ...emptyTimelineView(), following: false, top: 40 })
  const runtime = {
    timelineView: view, updateTimelineView: (patch: Partial<TimelineViewState>) => setView({ ...view(), ...patch }),
    messages: () => [
      { id: "u1", sessionID: "s1", role: "user", time: { created: 1 } },
      { id: "a1", sessionID: "s1", role: "assistant", parentID: "u1", time: { created: 2, completed: 1002 }, finish: "stop" },
    ],
    partsByMessage: () => ({ a1: [
      { id: "thought", type: "reasoning", text: "Checking configuration", messageID: "a1", sessionID: "s1", time: { start: 2, end: 1000 } },
      { id: "answer", type: "text", text: "Configuration complete", messageID: "a1", sessionID: "s1" },
    ] }),
    status: () => ({ type: "idle" }), busy: () => false, stopping: () => false, settling: () => false,
    stoppedTurnID: () => undefined, stoppedTurns: () => ({}), pendingPermissions: () => [], pendingQuestions: () => [],
    sessionError: () => "", syncError: () => "",
  } as unknown as RuntimeApi
  const original = HTMLElement.prototype.getBoundingClientRect
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (!this.matches("[data-scroll-key], [data-entry-key]")) return original.call(this)
    const expanded = view().processOpen.u1 === true
    const top = (this.matches(".worked-for") ? 160 : 210 + (expanded ? 180 : 0)) - this.closest(".timeline")!.scrollTop
    return { top, bottom: top + 30, left: 0, right: 700, width: 700, height: 30, x: 0, y: top, toJSON() {} }
  })
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(() => <StoreProviders runtime={runtime} projects={{ selectedSessionId: () => "s1", connection: () => "connected" } as ProjectApi}
    models={{ nameFor: () => "model" } as ModelApi} chrome={{} as ChromeApi}><MessageTimeline /></StoreProviders>, host)
  try {
    const scroller = host.querySelector<HTMLDivElement>(".timeline")!
    const summary = host.querySelector<HTMLButtonElement>(".worked-for > .work-head")!
    Object.defineProperties(scroller, { scrollHeight: { value: 1200 }, clientHeight: { value: 600 } })
    const initialTop = summary.parentElement!.getBoundingClientRect().top
    expect(document.activeElement).not.toBe(summary)
    // macOS mouse clicks need not focus buttons; keyboard/assistive clicks also
    // reach this handler without a pointerdown event.
    summary.click()
    resize([], {} as ResizeObserver)
    expect(view().processOpen.u1).toBe(true)
    expect(scroller.scrollTop).toBe(40)
    expect(summary.parentElement!.getBoundingClientRect().top).toBe(initialTop)
    // A later resize must retain the summary, rather than recapture the answer.
    resize([], {} as ResizeObserver)
    summary.click()
    resize([], {} as ResizeObserver)
    expect(view().processOpen.u1).toBe(false)
    expect(scroller.scrollTop).toBe(40)
    expect(summary.parentElement!.getBoundingClientRect().top).toBe(initialTop)
    expect(view().following).toBe(false)
  } finally { dispose(); host.remove() }
})

function mountScrollScenario(options: { height?: number; viewport?: number; savedTop?: number } = {}) {
  let height = options.height ?? 400
  let viewport = options.viewport ?? 600
  let top = options.savedTop ?? 0
  let resize!: ResizeObserverCallback
  let frame: FrameRequestCallback | undefined
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1 })
  vi.stubGlobal("cancelAnimationFrame", () => { frame = undefined })
  vi.stubGlobal("ResizeObserver", class { constructor(callback: ResizeObserverCallback) { resize = callback } observe() {} disconnect() {} })
  // Model the browser's scroll clamping, including content/viewport shrinkage.
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("timeline") ? viewport : 0 })
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("timeline") ? Math.max(height, viewport) : 0 })
  vi.spyOn(Element.prototype, "scrollTop", "get").mockImplementation(() => Math.min(top, Math.max(0, height - viewport)))
  vi.spyOn(Element.prototype, "scrollTop", "set").mockImplementation((value: number) => { top = Math.max(0, Math.min(value, height - viewport)) })
  const [messages, setMessages] = createSignal<import("../lib/types").Message[]>([])
  const [busy, setBusy] = createSignal(false)
  const [view, setView] = createSignal({ ...emptyTimelineView(), following: options.savedTop === undefined, top })
  const runtime = {
    timelineView: view, updateTimelineView: (patch: Partial<TimelineViewState>) => setView({ ...view(), ...patch }),
    messages, partsByMessage: () => ({}), status: () => ({ type: busy() ? "busy" : "idle" }), busy,
    stopping: () => false, settling: () => false, stoppedTurnID: () => undefined, stoppedTurns: () => ({}),
    pendingPermissions: () => [], pendingQuestions: () => [], sessionError: () => "", syncError: () => "",
    revertToMessage: vi.fn(async () => { height = 0; setMessages([]) }),
  } as unknown as RuntimeApi
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(() => <StoreProviders runtime={runtime} projects={{ selectedSessionId: () => "s1", connection: () => "connected" } as ProjectApi}
    models={{ nameFor: () => "model" } as ModelApi} chrome={{} as ChromeApi}><MessageTimeline /></StoreProviders>, host)
  const layout = () => { resize([], {} as ResizeObserver); const callback = frame; frame = undefined; callback?.(0) }
  const send = () => { setBusy(true); setMessages([{ id: "u1", sessionID: "s1", role: "user", time: { created: 1 } }]); layout() }
  return { host, view, runtime, layout, send, stop: () => { setBusy(false); layout() },
    scroller: host.querySelector<HTMLDivElement>(".timeline")!,
    height: (value: number) => { height = value }, viewport: (value: number) => { viewport = value },
    dispose: () => { dispose(); host.remove() } }
}

it.each(["wheel", "touch", "keyboard", "pointer"])("never shows jump-latest for a short sent/stopped turn paused by %s or after rollback", (input) => {
  const scene = mountScrollScenario()
  try {
    scene.send()
    scene.stop()
    const event = input === "wheel" ? new WheelEvent("wheel", { deltaY: -100, bubbles: true })
      : input === "keyboard" ? new KeyboardEvent("keydown", { key: "Home", bubbles: true })
      : input === "pointer" ? new MouseEvent("pointerdown", { bubbles: true })
      : new Event("touchstart", { bubbles: true })
    scene.scroller.dispatchEvent(event)
    expect(scene.view().following).toBe(false)
    expect(scene.host.querySelector(".jump-latest:not([disabled])")).toBeNull()
    scene.host.querySelector<HTMLButtonElement>(".rollback")!.click()
    scene.host.querySelector<HTMLButtonElement>(".dialog-actions .stop")!.click()
    scene.layout()
    expect(scene.runtime.revertToMessage).toHaveBeenCalledWith("u1")
    expect(scene.host.querySelector("[data-turn-id]")).toBeNull()
    expect(scene.host.querySelector(".jump-latest:not([disabled])")).toBeNull()
  } finally { scene.dispose() }
})

it.each([0, 400, 640, 679])("hides jump-latest without a scroll event when content shrinks to %i pixels", (height) => {
  const scene = mountScrollScenario({ height: 1400 })
  try {
    scene.send()
    scene.stop()
    scene.scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true }))
    scene.scroller.scrollTop = 0
    scene.scroller.dispatchEvent(new Event("scroll"))
    expect(scene.host.querySelector(".jump-latest:not([disabled])")).not.toBeNull()
    // Rollback, process collapse or completion removes content. Browsers need
    // not emit scroll when a scroller already at zero becomes shorter.
    scene.height(height)
    scene.layout()
    expect(scene.host.querySelector(".jump-latest:not([disabled])")).toBeNull()
    // Inspection remains paused so a later expansion keeps its anchor.
    expect(scene.view().following).toBe(false)
  } finally { scene.dispose() }
})

it("rechecks jump-latest when viewport grows and while paused content grows again", () => {
  const scene = mountScrollScenario({ height: 1400, savedTop: 100 })
  try {
    scene.send()
    expect(scene.host.querySelector(".jump-latest:not([disabled])")).not.toBeNull()
    scene.viewport(1400)
    scene.layout()
    expect(scene.host.querySelector(".jump-latest:not([disabled])")).toBeNull()
    scene.height(2200)
    scene.layout()
    expect(scene.host.querySelector(".jump-latest:not([disabled])")).not.toBeNull()
    scene.host.querySelector<HTMLButtonElement>(".jump-latest:not([disabled])")!.click()
    scene.layout()
    expect(scene.view().following).toBe(true)
    expect(scene.scroller.scrollTop).toBe(800)
    expect(scene.host.querySelector(".jump-latest:not([disabled])")).toBeNull()
  } finally { scene.dispose() }
})

it("hides jump-latest at the bottom even when selection pauses following", () => {
  const scene = mountScrollScenario({ height: 1400 })
  try {
    scene.send()
    scene.stop()
    const selection = { isCollapsed: false, rangeCount: 1, getRangeAt: () => ({ intersectsNode: () => true }) }
    vi.spyOn(window, "getSelection").mockReturnValue(selection as unknown as Selection)
    document.dispatchEvent(new Event("selectionchange"))
    expect(scene.view().following).toBe(false)
    expect(scene.host.querySelector(".jump-latest:not([disabled])")).toBeNull()
    scene.scroller.scrollTop = 100
    scene.scroller.dispatchEvent(new Event("scroll"))
    expect(scene.host.querySelector(".jump-latest:not([disabled])")).not.toBeNull()
    scene.scroller.scrollTop = 800
    scene.scroller.dispatchEvent(new Event("scroll"))
    expect(scene.host.querySelector(".jump-latest:not([disabled])")).toBeNull()
  } finally { scene.dispose() }
})

it("does not show jump-latest from a stale paused view while an empty session loads", () => {
  const scene = mountScrollScenario({ height: 0, savedTop: 400 })
  try {
    scene.layout()
    expect(scene.view().top).toBe(400)
    expect(scene.host.querySelector(".jump-latest:not([disabled])")).toBeNull()
    scene.send()
    expect(scene.scroller.scrollTop).toBe(0)
    expect(scene.host.querySelector(".jump-latest:not([disabled])")).toBeNull()
  } finally { scene.dispose() }
})
