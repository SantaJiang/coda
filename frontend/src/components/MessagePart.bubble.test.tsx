import { afterEach, expect, it, vi } from "vitest"
import { render } from "solid-js/web"
import { StoreProviders } from "../store/ctx"
import type { ChromeApi, ModelApi, ProjectApi, RuntimeApi } from "../store/contracts"
import { emptyTimelineView } from "../lib/conversation"
import { MessageTimeline } from "./MessageTimeline"

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function mount(text: string, scrollHeight: number) {
  vi.stubGlobal("requestAnimationFrame", () => 1)
  vi.stubGlobal("cancelAnimationFrame", () => {})
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: Element) {
      if (!element.classList.contains("user-bubble-body")) return
      Object.defineProperty(element, "scrollHeight", { configurable: true, get: () => scrollHeight })
      this.callback([], {} as ResizeObserver)
    }
    disconnect() {}
  })
  const runtime = {
    timelineView: () => emptyTimelineView(),
    updateTimelineView: () => {},
    messages: () => [{ id: "u1", sessionID: "s1", role: "user", time: { created: 1 } }],
    partsByMessage: () => ({ u1: [{ id: "t1", type: "text", text, messageID: "u1", sessionID: "s1" }] }),
    status: () => ({ type: "idle" }),
    busy: () => false,
    stopping: () => false,
    settling: () => false,
    stoppedTurnID: () => undefined,
    stoppedTurns: () => ({}),
    pendingPermissions: () => [],
    pendingQuestions: () => [],
    sessionError: () => "",
    syncError: () => "",
  } as unknown as RuntimeApi
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(() => (
    <StoreProviders
      runtime={runtime}
      projects={{ selectedSessionId: () => "s1", connection: () => "connected" } as ProjectApi}
      models={{ nameFor: () => "model" } as ModelApi}
      chrome={{} as ChromeApi}
    >
      <MessageTimeline />
    </StoreProviders>
  ), host)
  return {
    host,
    dispose() { dispose(); host.remove() },
  }
}

it("keeps a short sent prompt at its own height", () => {
  const scene = mount("短问题", 22)
  try {
    const body = scene.host.querySelector(".user-bubble-body")
    expect(body?.classList.contains("is-collapsed")).toBe(false)
    expect(scene.host.querySelector(".user-bubble-more")).toBeNull()
    expect(body?.textContent).toContain("短问题")
  } finally { scene.dispose() }
})

it("collapses a long sent prompt and expands it in place", () => {
  const scene = mount("x".repeat(2000), 800)
  try {
    const turn = scene.host.querySelector<HTMLElement>(".turn[data-role='user']")
    const body = scene.host.querySelector<HTMLElement>(".user-bubble-body")
    expect(body?.classList.contains("is-collapsed")).toBe(true)
    expect(body?.classList.contains("is-faded")).toBe(true)
    expect(body?.style.maxHeight).toBe("72px")
    expect(turn?.hasAttribute("data-expanded")).toBe(false)
    const button = scene.host.querySelector<HTMLButtonElement>(".user-bubble-more")
    expect(button?.textContent).toBe("展开")
    button?.click()
    expect(body?.classList.contains("is-expanded")).toBe(true)
    expect(body?.classList.contains("is-collapsed")).toBe(false)
    expect(body?.style.maxHeight).toBe("300px")
    expect(turn?.hasAttribute("data-expanded")).toBe(true)
    expect(button?.textContent).toBe("收起")
    expect(button?.getAttribute("aria-expanded")).toBe("true")
    button?.click()
    expect(body?.classList.contains("is-collapsed")).toBe(true)
    expect(body?.style.maxHeight).toBe("72px")
    expect(button?.textContent).toBe("展开")
  } finally { scene.dispose() }
})
