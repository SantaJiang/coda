import { describe, expect, it } from "vitest"
import { applyDerivedStatus, mergeMessages, mergeParts, resolveRacingSessionStatus, resolveSessionStatus } from "./session-sync"
import type { AssistantMessage, Part, TextPart, UserMessage } from "./types"

const user = (id: string, created = 1): UserMessage => ({
  id,
  sessionID: "s1",
  role: "user",
  time: { created },
})
const assistant = (id: string, over: Partial<AssistantMessage> = {}): AssistantMessage => ({
  id,
  sessionID: "s1",
  role: "assistant",
  time: { created: 2 },
  ...over,
})
const text = (id: string, value: string): TextPart => ({
  id,
  sessionID: "s1",
  messageID: "m1",
  type: "text",
  text: value,
})

describe("mergeMessages", () => {
  it("keeps a completed local assistant over an incomplete snapshot", () => {
    const local = [assistant("a1", { time: { created: 2, completed: 9 } })]
    const incoming = [assistant("a1")]
    expect(mergeMessages(local, incoming)[0]).toEqual(local[0])
  })

  it("appends a newer local message that the snapshot missed", () => {
    const incoming = [user("u1", 1), assistant("a1", { time: { created: 2, completed: 3 } })]
    const local = [...incoming, user("u2", 4)]
    expect(mergeMessages(local, incoming).map((item) => item.id)).toEqual(["u1", "a1", "u2"])
  })

  it("does not resurrect older local messages dropped by compaction", () => {
    const local = [user("old", 1), assistant("a1", { time: { created: 8, completed: 9 } })]
    const incoming = [assistant("a1", { time: { created: 8, completed: 9 } })]
    expect(mergeMessages(local, incoming).map((item) => item.id)).toEqual(["a1"])
  })

  it("keeps local messages when the snapshot is empty", () => {
    const local = [user("u1")]
    expect(mergeMessages(local, [])).toEqual(local)
  })
})

describe("mergeParts", () => {
  it("keeps streamed text when a later snapshot changes the part type", () => {
    const local: Part[] = [text("p1", "hello world")]
    const incoming: Part[] = [
      {
        id: "p1",
        sessionID: "s1",
        messageID: "m1",
        type: "reasoning",
        text: "hello",
      },
    ]
    expect(mergeParts(local, incoming)[0]).toMatchObject({ type: "reasoning", text: "hello world" })
  })

  it("keeps the longer streamed text when the snapshot is behind", () => {
    const local: Part[] = [text("p1", "hello world")]
    const incoming: Part[] = [text("p1", "hello")]
    expect((mergeParts(local, incoming)[0] as TextPart).text).toBe("hello world")
  })

  it("keeps local-only parts that arrived after the snapshot", () => {
    const local: Part[] = [text("p1", "a"), text("p2", "b")]
    const incoming: Part[] = [text("p1", "a")]
    expect(mergeParts(local, incoming).map((item) => item.id)).toEqual(["p1", "p2"])
  })

  it("keeps completed reasoning timing when a resync snapshot is stale", () => {
    const local: Part[] = [
      {
        id: "r1",
        sessionID: "s1",
        messageID: "m1",
        type: "reasoning",
        text: "complete thought",
        time: { start: 1_000, end: 3_000 },
      },
    ]
    const incoming: Part[] = [
      {
        id: "r1",
        sessionID: "s1",
        messageID: "m1",
        type: "reasoning",
        text: "complete",
        time: { start: 1_000 },
      },
    ]

    expect(mergeParts(local, incoming)[0]).toEqual(local[0])
  })

  it("keeps a completed local tool over a running snapshot", () => {
    const local: Part[] = [
      {
        id: "t1",
        sessionID: "s1",
        messageID: "m1",
        type: "tool",
        callID: "c1",
        tool: "read",
        state: { status: "completed", output: "ok" },
      },
    ]
    const incoming: Part[] = [
      {
        id: "t1",
        sessionID: "s1",
        messageID: "m1",
        type: "tool",
        callID: "c1",
        tool: "read",
        state: { status: "running" },
      },
    ]
    expect(mergeParts(local, incoming)[0]).toEqual(local[0])
  })
})

describe("applyDerivedStatus", () => {
  it("does not regress an SSE idle back to a stale busy snapshot", () => {
    expect(applyDerivedStatus({ type: "idle" }, { type: "busy" }, true)).toEqual({ type: "idle" })
  })

  it("unsticks a busy session when the snapshot says idle", () => {
    expect(applyDerivedStatus({ type: "busy" }, { type: "idle" }, true)).toEqual({ type: "idle" })
  })

  it("treats absence from the authoritative live status map as idle", () => {
    expect(resolveSessionStatus("s1", {}, { type: "busy" }, { type: "busy" }, false)).toEqual({ type: "idle" })
    expect(resolveSessionStatus("s1", { s1: { type: "retry", attempt: 2 } }, undefined, null)).toEqual({
      type: "retry",
      attempt: 2,
    })
  })

  it("falls back to message-derived status when the live status request fails", () => {
    expect(resolveSessionStatus("s1", null, undefined, { type: "busy" }, false)).toEqual({ type: "busy" })
  })

  it("trusts authoritative busy even after an assistant step completed", () => {
    expect(
      resolveSessionStatus("s1", { s1: { type: "busy" } }, { type: "idle" }, { type: "idle" }, true, "assistant"),
    ).toEqual({ type: "busy" })
    expect(
      resolveSessionStatus("s1", { s1: { type: "busy" } }, { type: "busy" }, { type: "idle" }, true, "assistant"),
    ).toEqual({ type: "busy" })
  })

  it("still trusts live busy when a new user turn is waiting", () => {
    expect(
      resolveSessionStatus("s1", { s1: { type: "busy" } }, { type: "idle" }, { type: "idle" }, true, "user"),
    ).toEqual({ type: "busy" })
  })

  it("preserves live busy when only an assistant step has completed", () => {
    expect(resolveRacingSessionStatus({ type: "busy" }, { type: "idle" }, "assistant")).toEqual({ type: "busy" })
  })

  it("keeps SSE busy/retry when a new user turn arrived during the snapshot", () => {
    expect(resolveRacingSessionStatus({ type: "busy" }, { type: "idle" }, "user")).toEqual({ type: "busy" })
    expect(resolveRacingSessionStatus({ type: "retry", attempt: 2 }, { type: "busy" }, "assistant")).toEqual({
      type: "retry",
      attempt: 2,
    })
  })
})
