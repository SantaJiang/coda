import { describe, expect, it } from "vitest"
import { isActiveStatus, isSessionBusy, sessionDotKind, sessionHasBlockers } from "./session-status"

describe("session status", () => {
  it("treats retry as an active/busy state", () => {
    expect(isActiveStatus({ type: "retry", attempt: 1 })).toBe(true)
    expect(isSessionBusy({ type: "retry" })).toBe(true)
    expect(isSessionBusy({ type: "idle" })).toBe(false)
    expect(isSessionBusy({ type: "idle" }, true)).toBe(true)
  })

  it("detects permission and question blockers", () => {
    expect(
      sessionHasBlockers("s1", { a: { id: "a", sessionID: "s1", permission: "edit", patterns: [] } }, {}),
    ).toBe(true)
    expect(
      sessionHasBlockers("s1", {}, { q: { id: "q", sessionID: "s2", questions: [] } }),
    ).toBe(false)
  })

  it("ranks session dots wait > error > busy > unread", () => {
    const base = {
      sessionID: "s1",
      permissions: {} as Record<string, undefined>,
      questions: {} as Record<string, undefined>,
      sessionErrors: {},
    }
    expect(
      sessionDotKind({
        ...base,
        permissions: { a: { id: "a", sessionID: "s1", permission: "edit", patterns: [] } },
        sessionErrors: { s1: true },
        status: { type: "busy" },
        attention: true,
      }),
    ).toBe("wait")
    expect(sessionDotKind({ ...base, sessionErrors: { s1: true }, attention: true })).toBe("error")
    expect(sessionDotKind({ ...base, status: { type: "retry" }, attention: true })).toBe("busy")
    expect(sessionDotKind({ ...base, attention: true })).toBe("unread")
    expect(sessionDotKind(base)).toBeNull()
  })
})
