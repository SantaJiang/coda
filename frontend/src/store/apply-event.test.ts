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
      draftPlanMode: true,
      messages: { s1: [{ id: "m1", sessionID: "s1", role: "user", time: { created: 1 } }] },
      parts: { m1: [] },
      queuedBySession: {
        s1: [
          {
            id: "q",
            text: "x",
            attachments: [],
            agent: "build",
            model: { providerID: "a", modelID: "b" },
            variant: null,
            directory: "/tmp/app",
          },
        ],
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
    expect(state.draftPlanMode).toBe(false)
    expect(state.draft).toBe(true)
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

  it("keeps session errors on the session instead of the global banner", () => {
    const state = draft({
      selectedSessionId: "s1",
      error: null,
      messages: {
        s1: [{ id: "a1", sessionID: "s1", role: "assistant", time: { created: 1 } }],
      },
    })
    applyClientEvent(state, {
      event: {
        type: "session.error",
        properties: { sessionID: "s1", error: { data: { message: "model failed" } } },
      },
    })
    expect(state.sessionErrors.s1).toBe(true)
    expect(state.error).toBeNull()
    expect(state.messages.s1[0]).toMatchObject({
      role: "assistant",
      error: { data: { message: "model failed" } },
    })
    const assistant = state.messages.s1[0]
    expect(assistant?.role === "assistant" ? assistant.time.completed : undefined).toEqual(expect.any(Number))
  })

  it("keeps a session error card when no assistant message exists yet", () => {
    const state = draft({ selectedSessionId: "s1", error: null })
    applyClientEvent(state, {
      event: {
        type: "session.error",
        properties: {
          sessionID: "s1",
          error: { data: { message: "Cause([Die(TypeError: undefined is not an object (evaluating 'a.name'))])" } },
        },
      },
    })
    expect(state.sessionErrors.s1).toBe(true)
    expect(state.sessionErrorText.s1).toBe("TypeError: undefined is not an object (evaluating 'a.name')")
    expect(state.error).toBeNull()
  })

  it("does not misattribute a crash to the previous completed turn", () => {
    const state = draft({
      selectedSessionId: "s1",
      error: null,
      messages: {
        s1: [
          { id: "u1", sessionID: "s1", role: "user", time: { created: 1 } },
          { id: "a1", sessionID: "s1", role: "assistant", time: { created: 1, completed: 2 } },
        ],
      },
    })
    applyClientEvent(state, {
      event: {
        type: "session.error",
        properties: { sessionID: "s1", error: { data: { message: "boom" } } },
      },
    })
    expect(state.sessionErrors.s1).toBe(true)
    expect(state.messages.s1[1]).not.toHaveProperty("error")
    expect(state.sessionErrorText.s1).toBe("boom")
  })

  it("does not flag a session as errored when the user stopped it", () => {
    const aborted = { name: "MessageAbortedError", data: { message: "Aborted" } }
    const state = draft({ selectedSessionId: "other", error: null })
    applyClientEvent(state, {
      event: {
        type: "message.updated",
        properties: {
          sessionID: "s1",
          info: { id: "a1", sessionID: "s1", role: "assistant", time: { created: 1, completed: 2 }, error: aborted },
        },
      },
    })
    applyClientEvent(state, {
      event: { type: "session.error", properties: { sessionID: "s2", error: aborted } },
    })
    expect(state.sessionErrors.s1).toBeUndefined()
    expect(state.sessionErrors.s2).toBeUndefined()
    expect(state.error).toBeNull()
  })

  it("clears a session error once a later assistant turn completes", () => {
    const state = draft({
      sessionErrors: { s1: true },
      sessionErrorText: { s1: "旧错误" },
      messages: {
        s1: [
          {
            id: "a1",
            sessionID: "s1",
            role: "assistant",
            time: { created: 1 },
            error: { name: "APIError", data: { message: "provider down" } },
          },
        ],
      },
    })
    applyClientEvent(state, {
      event: {
        type: "message.updated",
        properties: {
          sessionID: "s1",
          info: { id: "a2", sessionID: "s1", role: "assistant", time: { created: 2, completed: 3 } },
        },
      },
    })
    expect(state.sessionErrors.s1).toBeUndefined()
    expect(state.sessionErrorText.s1).toBeUndefined()
  })

  it("keeps the longer streamed text when a part snapshot is behind", () => {
    const state = draft({
      parts: {
        m1: [{ id: "p1", sessionID: "s1", messageID: "m1", type: "text", text: "hello world" }],
      },
    })
    applyClientEvent(state, {
      event: {
        type: "message.part.updated",
        properties: {
          part: { id: "p1", sessionID: "s1", messageID: "m1", type: "text", text: "hello" },
        },
      },
    })
    expect(state.parts.m1[0]).toMatchObject({ text: "hello world" })
  })

  it("flags a session on a real assistant failure", () => {
    const state = draft({ selectedSessionId: "other", error: null })
    applyClientEvent(state, {
      event: {
        type: "message.updated",
        properties: {
          sessionID: "s1",
          info: {
            id: "a1",
            sessionID: "s1",
            role: "assistant",
            time: { created: 1 },
            error: { name: "APIError", data: { message: "provider down" } },
          },
        },
      },
    })
    expect(state.sessionErrors.s1).toBe(true)
    expect(state.error).toBeNull()
  })

  it("still surfaces a missing directory on the global banner", () => {
    const state = draft({
      error: null,
      projects: [{ id: "p1", name: "app", path: "/tmp/app", expanded: true }],
    })
    applyClientEvent(state, {
      event: {
        type: "session.error",
        properties: { sessionID: "s1", message: "ENOENT: no such file or directory, lstat '/tmp/app'" },
      },
    })
    expect(state.error).toMatch(/重新定位/)
    expect(state.projects[0]?.missing).toBe(true)
  })
})

describe("stream event ordering", () => {
  it("deduplicates identified delta events without dropping legitimate repeated text", () => {
    const state = draft()
    const event = { id: "evt1", type: "message.part.delta", properties: { messageID: "a1", partID: "p1", sessionID: "s1", delta: "ha" } }
    applyClientEvent(state, { event })
    applyClientEvent(state, { event })
    applyClientEvent(state, { event: { ...event, id: "evt2" } })
    expect(state.parts.a1[0]).toMatchObject({ text: "haha" })
  })
  it("retypes an early delta as reasoning without losing its content", () => {
    const state = draft()
    applyClientEvent(state, { event: { type: "message.part.delta", properties: { messageID: "a1", partID: "p1", sessionID: "s1", delta: "完整思考" } } })
    applyClientEvent(state, { event: { type: "message.part.updated", properties: { part: { id: "p1", type: "reasoning", text: "完整", messageID: "a1", sessionID: "s1", time: { start: 1, end: 2 } } } } })
    expect(state.parts.a1[0]).toMatchObject({ type: "reasoning", text: "完整思考", time: { end: 2 } })
  })
  it("updates a tool in place instead of moving it in front of earlier prose", () => {
    const state = draft({ parts: { a1: [{ id: "p1", type: "text", text: "先检查", messageID: "a1", sessionID: "s1" }, { id: "p2", type: "tool", tool: "read", callID: "c1", state: { status: "running" }, messageID: "a1", sessionID: "s1" }] } })
    applyClientEvent(state, { event: { type: "message.part.updated", properties: { part: { id: "p2", type: "tool", tool: "read", callID: "c1", state: { status: "completed", output: "ok" }, messageID: "a1", sessionID: "s1" } } } })
    expect(state.parts.a1.map((part) => part.id)).toEqual(["p1", "p2"])
  })
  it("treats status-idle as a reconciliation boundary", () => {
    const state = draft()
    const effects = applyClientEvent(state, { event: { type: "session.status", properties: { sessionID: "s1", status: { type: "idle" } } } })
    expect(state.settlingBySession.s1).toBe(true)
    expect(effects.idleSessions).toEqual(["s1"])
  })
})
