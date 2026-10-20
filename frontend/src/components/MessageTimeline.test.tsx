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
