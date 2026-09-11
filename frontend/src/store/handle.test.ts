import { describe, expect, it } from "vitest"
import { activePlanMode } from "./handle"
import { initialState, type AppState } from "./state"

function makeState(overrides: Partial<AppState> = {}): AppState {
  return { ...structuredClone(initialState), ...overrides }
}

describe("activePlanMode", () => {
  it("reads the per-session value when a session is selected", () => {
    expect(activePlanMode(makeState({ selectedSessionId: "s1", planModeBySession: { s1: true } }))).toBe(true)
    expect(activePlanMode(makeState({ selectedSessionId: "s1", planModeBySession: { s2: true } }))).toBe(false)
  })

  it("defaults to false for a session with no stored value", () => {
    expect(activePlanMode(makeState({ selectedSessionId: "s1" }))).toBe(false)
  })

  it("reads the ephemeral draft value when no session is selected", () => {
    expect(activePlanMode(makeState({ selectedSessionId: null, draftPlanMode: true }))).toBe(true)
    expect(activePlanMode(makeState({ selectedSessionId: null }))).toBe(false)
  })
})
