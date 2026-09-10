import { describe, expect, it } from "vitest"
import { applyClientEvent } from "./apply-event"
import { initialState, type AppState } from "./state"

function draft(overrides: Partial<AppState> = {}): AppState {
  return {
    ...structuredClone(initialState),
    ...overrides,
  }
}

describe("applyClientEvent", () => {
  it("records idle sessions so the queue can flush per session", () => {
    const state = draft({ selectedSessionId: "other" })
    const effects = applyClientEvent(state, {
      event: { type: "session.idle", properties: { sessionID: "s1" } },
    })
    expect(effects.idleSessions).toEqual(["s1"])
    expect(state.status.s1).toEqual({ type: "idle" })
    expect(state.attention.s1).toBe(true)
  })

  it("purges session data on delete", () => {
    const state = draft({
      selectedSessionId: "s1",
      messages: { s1: [{ id: "m1", sessionID: "s1", role: "user", time: { created: 1 } }] },
      parts: { m1: [] },
      queuedBySession: {
        s1: [{ id: "q", text: "x", attachments: [], agent: "build", model: { providerID: "a", modelID: "b" }, variant: null }],
      },
      sessionsByProject: {
        "/tmp/app": [{ id: "s1", directory: "/tmp/app", title: "t", time: { created: 1, updated: 1 } }],
      },
    })
    applyClientEvent(state, {
      directory: "/tmp/app",
      event: { type: "session.deleted", properties: { sessionID: "s1" } },
    })
    expect(state.messages.s1).toBeUndefined()
    expect(state.parts.m1).toBeUndefined()
    expect(state.queuedBySession.s1).toBeUndefined()
    expect(state.selectedSessionId).toBeNull()
  })

  it("auto-replies permissions without dropping the request on later failure", () => {
    const state = draft({ permissionMode: "allow" })
    state.sessionsByProject["/tmp/app"] = [
      { id: "s1", directory: "/tmp/app", title: "t", time: { created: 1, updated: 1 } },
    ]
    const effects = applyClientEvent(state, {
      directory: "/tmp/app",
      event: {
        type: "permission.asked",
        properties: { id: "p1", sessionID: "s1", permission: "edit", patterns: ["*"] },
      },
    })
    expect(effects.autoReplies).toHaveLength(1)
    expect(effects.autoReplies[0]?.reply).toBe("always")
    expect(state.permissions.p1).toBeUndefined()
  })

  it("ignores unknown event types without mutating state", () => {
    const state = draft({ selectedSessionId: "s1", error: null })
    const snapshot = structuredClone(state)
    const effects = applyClientEvent(state, {
      event: { type: "server.unknown", properties: { sessionID: "s1" } },
    })
    expect(effects.autoReplies).toEqual([])
    expect(effects.idleSessions).toEqual([])
    expect(state).toEqual(snapshot)
  })
})
