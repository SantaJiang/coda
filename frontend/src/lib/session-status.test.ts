import { describe, expect, it } from "vitest"
import {
  deriveStatusFromMessages,
  formatSessionErrorMessage,
  hasFailingAssistant,
  isAbortError,
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

  it("unwraps Cause(Die(...)) session error text", () => {
    expect(
      formatSessionErrorMessage("Cause([Die(TypeError: undefined is not an object (evaluating 'a.name'))])"),
    ).toBe("TypeError: undefined is not an object (evaluating 'a.name')")
    expect(formatSessionErrorMessage("provider down")).toBe("provider down")
    expect(formatSessionErrorMessage("")).toBe("")
  })

  it("detects an assistant error on the session", () => {
    expect(hasFailingAssistant([])).toBe(false)
    expect(hasFailingAssistant([user("u1"), assistant("a1")])).toBe(false)
    expect(hasFailingAssistant([assistant("a1", { error: { data: { message: "boom" } } })])).toBe(true)
  })

  it("treats a user abort as a stop, not a failure", () => {
    expect(isAbortError({ name: "MessageAbortedError", data: { message: "Aborted" } })).toBe(true)
    expect(isAbortError({ data: { message: "Aborted" } })).toBe(true)
    expect(isAbortError("Aborted")).toBe(true)
    expect(isAbortError({ name: "APIError", data: { message: "boom" } })).toBe(false)
    expect(isAbortError(undefined)).toBe(false)
    expect(
      hasFailingAssistant([
        assistant("a1", { error: { name: "MessageAbortedError", data: { message: "Aborted" } } }),
      ]),
    ).toBe(false)
  })

  it("only flags the latest assistant turn, so a recovered session is not stuck red", () => {
    const messages: Message[] = [
      assistant("a1", { error: { data: { message: "boom" } } }),
      user("u2"),
      assistant("a2", { time: { created: 3, completed: 4 } }),
    ]
    expect(hasFailingAssistant(messages)).toBe(false)
    expect(hasFailingAssistant(messages.slice(0, 1))).toBe(true)
  })
})

it("does not reuse an earlier turn's status when a newer user message is waiting", () => {
  const messages = [assistant("a1", { error: { data: { message: "earlier failure" } }, time: { created: 2, completed: 3 } }), user("u2")]
  expect(hasFailingAssistant(messages)).toBe(false)
  expect(deriveStatusFromMessages(messages)).toBeNull()
})
