import { describe, expect, it } from "vitest"
import { purgeSession, syncSessionRequests } from "./gc"
import { initialState } from "./state"

describe("purgeSession", () => {
  it("removes messages, parts, queue and pending prompts for that session only", () => {
    const draft = structuredClone(initialState)
    draft.messages = {
      s1: [{ id: "m1", sessionID: "s1", role: "user", time: { created: 1 } }],
      s2: [{ id: "m2", sessionID: "s2", role: "user", time: { created: 1 } }],
    }
    draft.parts = { m1: [], m2: [] }
    draft.permissions = {
      p1: { id: "p1", sessionID: "s1", permission: "edit", patterns: [] },
      p2: { id: "p2", sessionID: "s2", permission: "edit", patterns: [] },
    }
    draft.planModeBySession = { s1: true, s2: true }
    draft.resolvedRequests = { "permission:one": "s1", "question:two": "s2" }
    purgeSession(draft, "s1")
    expect(draft.messages.s1).toBeUndefined()
    expect(draft.parts.m1).toBeUndefined()
    expect(draft.messages.s2).toHaveLength(1)
    expect(draft.permissions.p1).toBeUndefined()
    expect(draft.permissions.p2).toBeDefined()
    expect(draft.planModeBySession.s1).toBeUndefined()
    expect(draft.planModeBySession.s2).toBe(true)
    expect(draft.resolvedRequests).toEqual({ "question:two": "s2" })
  })
})

describe("syncSessionRequests", () => {
  it("drops stale permission and question ids", () => {
    const draft = structuredClone(initialState)
    draft.permissions = {
      old: { id: "old", sessionID: "s1", permission: "edit", patterns: [] },
    }
    draft.questions = {
      oldq: { id: "oldq", sessionID: "s1", questions: [] },
    }
    syncSessionRequests(
      draft,
      "s1",
      [{ id: "new", sessionID: "s1", permission: "edit", patterns: [] }],
      [{ id: "newq", sessionID: "s1", questions: [] }],
    )
    expect(draft.permissions.old).toBeUndefined()
    expect(draft.permissions.new).toBeDefined()
    expect(draft.questions.oldq).toBeUndefined()
    expect(draft.questions.newq).toBeDefined()
  })

  it("can keep local requests that a stale snapshot omitted", () => {
    const draft = structuredClone(initialState)
    draft.permissions = {
      live: { id: "live", sessionID: "s1", permission: "edit", patterns: [] },
    }
    syncSessionRequests(draft, "s1", [], [], { dropMissing: false })
    expect(draft.permissions.live).toBeDefined()
  })
})
