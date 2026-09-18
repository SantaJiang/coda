import { describe, expect, it } from "vitest"
import { selectedSessionOf, activePlanMode, inferPlanMode } from "./handle"
import { initialState, type AppState } from "./state"

function makeState(overrides: Partial<AppState> = {}): AppState {
  return { ...structuredClone(initialState), ...overrides }
}

describe("selectedSessionOf", () => {
  it("resolves local drafts from the draft list", () => {
    const draft = {
      id: "draft_1",
      directory: "/tmp/app",
      title: "新会话",
      localDraft: true as const,
      time: { created: 1, updated: 1 },
    }
    const state = makeState({
      projects: [{ id: "p1", name: "app", path: "/tmp/app", expanded: true }],
      selectedProjectId: "p1",
      selectedSessionId: "draft_1",
      draftSessionsByProject: { "/tmp/app": [draft] },
    })
    expect(selectedSessionOf(state)?.id).toBe("draft_1")
    expect(selectedSessionOf(state)?.localDraft).toBe(true)
  })
})

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

describe("inferPlanMode", () => {
  it("uses the latest message agent before the session agent", () => {
    expect(
      inferPlanMode({ agent: "build" }, [
        { id: "u1", sessionID: "s1", role: "user", time: { created: 1 }, agent: "plan" },
      ]),
    ).toBe(true)
    expect(
      inferPlanMode({ agent: "plan" }, [
        { id: "u1", sessionID: "s1", role: "user", time: { created: 1 }, agent: "build" },
      ]),
    ).toBe(false)
  })

  it("falls back to the session agent when messages have none", () => {
    expect(inferPlanMode({ agent: "plan" }, [])).toBe(true)
    expect(inferPlanMode({ agent: "build" })).toBe(false)
  })
})
