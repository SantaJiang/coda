import { describe, expect, it } from "vitest"
import {
  deriveStatusFromMessages,
  hasAssistantError,
  isActiveStatus,
  isSessionBusy,
  sessionDotKind,
  sessionHasBlockers,
} from "./session-status"
import type { AssistantMessage, Message, UserMessage } from "./types"

const user = (id: string): UserMessage => ({ id, sessionID: "s1", role: "user", time: { created: 1 } })
const assistant = (id: string, over?: Partial<AssistantMessage>): AssistantMessage => ({
  id,
  sessionID: "s1",
  role: "assistant",
  time: { created: 2 },
  ...over,
})

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

  it("derives busy/idle from the latest assistant message", () => {
    expect(deriveStatusFromMessages([])).toBeNull()
    expect(deriveStatusFromMessages([user("u1")])).toBeNull()
    expect(deriveStatusFromMessages([user("u1"), assistant("a1")])).toEqual({ type: "busy" })
    expect(deriveStatusFromMessages([assistant("a1", { time: { created: 2, completed: 9 } })])).toEqual({
      type: "idle",
    })
    expect(deriveStatusFromMessages([assistant("a1", { error: { data: { message: "boom" } } })])).toEqual({
      type: "idle",
    })
    const mixed: Message[] = [assistant("a1", { time: { created: 2, completed: 9 } }), user("u2"), assistant("a2")]
    expect(deriveStatusFromMessages(mixed)).toEqual({ type: "busy" })
  })

  it("detects an assistant error on the session", () => {
    expect(hasAssistantError([])).toBe(false)
    expect(hasAssistantError([user("u1"), assistant("a1")])).toBe(false)
    expect(hasAssistantError([assistant("a1", { error: { data: { message: "boom" } } })])).toBe(true)
  })
})
