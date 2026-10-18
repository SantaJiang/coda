import { expect, it, vi } from "vitest"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { reportDesktopActivity } from "../lib/desktop"
import { hasDesktopActivity, trackDesktopActivity } from "./desktop-activity"
import { initialState } from "./state"

vi.mock("../lib/desktop", () => ({ reportDesktopActivity: vi.fn().mockResolvedValue(undefined) }))

it("reports sending and completion immediately without waiting for a polling interval", async () => {
  const [state, setState] = createStore(structuredClone(initialState))
  const dispose = createRoot((dispose) => { trackDesktopActivity(state); return dispose })
  try {
    await Promise.resolve()
    expect(reportDesktopActivity).toHaveBeenLastCalledWith(false)
    setState("sendingBySession", "new-session", true)
    expect(reportDesktopActivity).toHaveBeenLastCalledWith(true)
    setState("sendingBySession", "new-session", false)
    expect(reportDesktopActivity).toHaveBeenLastCalledWith(false)
  } finally { dispose() }
})

it("includes sessions outside the selected project and retrying sessions", () => {
  const state = structuredClone(initialState)
  state.status.other = { type: "busy" }
  expect(hasDesktopActivity(state)).toBe(true)
  state.status.other = { type: "retry" }
  expect(hasDesktopActivity(state)).toBe(true)
  state.status.other = { type: "idle" }
  expect(hasDesktopActivity(state)).toBe(false)
})

it("warns for uncertain delivery but permits quitting after a definitive send failure", () => {
  const state = structuredClone(initialState)
  state.outgoing.u1 = { sessionID: "s1", messageID: "u1" } as typeof state.outgoing[string]
  state.messages.s1 = [{ id: "u1", sessionID: "s1", role: "user", time: { created: 1 }, delivery: "failed" }]
  expect(hasDesktopActivity(state)).toBe(false)
  state.messages.s1[0] = { ...state.messages.s1[0], role: "user", delivery: "uncertain" }
  expect(hasDesktopActivity(state)).toBe(true)
})

it("keeps permission and question waits active even when the backend status is idle", () => {
  const state = structuredClone(initialState)
  state.permissions.p1 = { sessionID: "s1" } as typeof state.permissions[string]
  expect(hasDesktopActivity(state)).toBe(true)
  delete state.permissions.p1
  state.questions.q1 = { sessionID: "s1" } as typeof state.questions[string]
  expect(hasDesktopActivity(state)).toBe(true)
})
