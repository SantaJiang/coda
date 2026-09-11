import { describe, expect, it } from "vitest"
import { applyDerivedStatus, mergeMessages, mergeParts } from "./session-sync"
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
})
