import { describe, expect, it } from "vitest"
import { compactionLabel, groupTurns, isInterruptedTurn, isVisiblePart, nextLiveItemKey, timelineItemKey } from "./MessagePart"
import type { AssistantMessage, Message, Part, ReasoningPart, TextPart, ToolPart, UserMessage } from "../lib/types"

const user = (id: string, created: number): UserMessage => ({
  id,
  sessionID: "s1",
  role: "user",
  time: { created },
})

const assistant = (id: string, parentID: string, created: number, over: Partial<AssistantMessage> = {}): AssistantMessage => ({
  id,
  parentID,
  sessionID: "s1",
  role: "assistant",
  time: { created, completed: created + 1 },
  ...over,
})

describe("groupTurns", () => {
  it("uses parentID when assistant events arrive after a newer user turn", () => {
    const messages: Message[] = [
      user("u1", 1),
      user("u2", 2),
      assistant("a1", "u1", 3),
      assistant("a2", "u2", 4),
    ]
    const turns = groupTurns(messages).filter((item) => item.kind === "turn")
    expect(turns).toHaveLength(2)
    expect(turns[0].assistants.map((message) => message.id)).toEqual(["a1"])
    expect(turns[1].assistants.map((message) => message.id)).toEqual(["a2"])
  })

  it("keeps a failed compaction out of the visible conversation turn", () => {
    const compactUser = user("compact", 1)
    const failed = assistant("summary", "compact", 2, {
      error: { name: "APIError", data: { message: "provider down" } },
    })
    const parts: Record<string, Part[]> = {
      compact: [{ id: "p1", sessionID: "s1", messageID: "compact", type: "compaction" }],
    }

    expect(groupTurns([compactUser, failed], parts)).toEqual([
      { kind: "compaction", id: "compact", status: "error", error: "provider down" },
    ])
  })

  it("does not absorb a parented reply into a later running compaction", () => {
    const compactUser = user("compact", 2)
    const parts: Record<string, Part[]> = {
      compact: [{ id: "p1", sessionID: "s1", messageID: "compact", type: "compaction" }],
    }
    const items = groupTurns([user("u1", 1), compactUser, assistant("a1", "u1", 3)], parts)
    const turns = items.filter((item) => item.kind === "turn")

    expect(items.filter((item) => item.kind === "compaction")).toEqual([
      { kind: "compaction", id: "compact", status: "running" },
    ])
    expect(turns).toHaveLength(1)
    expect(turns[0].assistants.map((message) => message.id)).toEqual(["a1"])
  })

  it("treats an aborted compaction as interrupted instead of failed", () => {
    const compactUser = user("compact", 1)
    const aborted = assistant("summary", "compact", 2, {
      error: { name: "MessageAbortedError", data: { message: "Aborted" } },
    })
    const parts: Record<string, Part[]> = {
      compact: [{ id: "p1", sessionID: "s1", messageID: "compact", type: "compaction" }],
    }

    expect(groupTurns([compactUser, aborted], parts)).toEqual([
      { kind: "compaction", id: "compact", status: "running" },
    ])
  })

  it("does not present an unfinished idle compaction as completed", () => {
    expect(compactionLabel("running")).toBe("Context compaction interrupted")
    expect(compactionLabel("done")).toBe("Context compacted")
    expect(compactionLabel("error")).toBe("Context compaction failed")
  })
})

describe("isInterruptedTurn", () => {
  it("only marks an unfinished assistant after the session is idle", () => {
    const unfinished = assistant("a1", "u1", 1, { time: { created: 1 } })
    expect(isInterruptedTurn(false, false, unfinished)).toBe(true)
    expect(isInterruptedTurn(false, true, unfinished)).toBe(false)
    expect(isInterruptedTurn(true, true, unfinished)).toBe(false)
    expect(isInterruptedTurn(false, false, assistant("a2", "u1", 1))).toBe(false)
  })
})

describe("isVisiblePart", () => {
  const reasoning = (text?: string): ReasoningPart => ({
    id: "r1",
    sessionID: "s1",
    messageID: "a1",
    type: "reasoning",
    text: text ?? "",
  })

  const text = (over: Partial<TextPart> = {}): TextPart => ({
    id: "t1",
    sessionID: "s1",
    messageID: "a1",
    type: "text",
    text: "hello",
    ...over,
  })

  const tool = (name: string, status: ToolPart["state"]["status"]): Part => ({
    id: `tool-${name}-${status}`,
    sessionID: "s1",
    messageID: "a1",
    type: "tool",
    tool: name,
    state: { status, input: {} },
  }) as Part

  it("hides encrypted reasoning without displayable text so Thinking never expands into an empty panel", () => {
    expect(isVisiblePart(reasoning(""))).toBe(false)
    expect(isVisiblePart(reasoning("   \n  "))).toBe(false)
    expect(isVisiblePart(reasoning("thinking out loud"))).toBe(true)
  })

  it("keeps the existing visibility rules for other parts", () => {
    expect(isVisiblePart(text())).toBe(true)
    expect(isVisiblePart(text({ ignored: true }))).toBe(false)
    expect(isVisiblePart(text({ synthetic: true }))).toBe(false)
    expect(isVisiblePart(tool("todowrite", "running"))).toBe(false)
    expect(isVisiblePart(tool("todowrite", "completed"))).toBe(true)
    expect(isVisiblePart(tool("question", "pending"))).toBe(false)
    expect(isVisiblePart(tool("question", "error"))).toBe(true)
    expect(isVisiblePart(tool("bash", "running"))).toBe(true)
  })
})

describe("nextLiveItemKey", () => {
  it("leaves a settled turn alone while the next prompt is still in flight", () => {
    const items = groupTurns([user("u1", 1), assistant("a1", "u1", 2)])
    expect(nextLiveItemKey("", true, items)).toBe("")
  })

  it("marks the trailing turn live once its reply starts streaming", () => {
    const items = groupTurns([user("u1", 1), assistant("a1", "u1", 2, { time: { created: 2 } })])
    expect(nextLiveItemKey("", true, items)).toBe("turn:u1")
  })

  it("keeps a latched turn live when a step settles before the next one starts", () => {
    const items = groupTurns([user("u1", 1), assistant("a1", "u1", 2)])
    expect(nextLiveItemKey("turn:u1", true, items)).toBe("turn:u1")
  })

  it("moves the live turn to the newer question", () => {
    const items = groupTurns([user("u1", 1), assistant("a1", "u1", 2), user("u2", 3)])
    expect(nextLiveItemKey("turn:u1", true, items)).toBe("turn:u2")
  })

  it("drops the live turn once the session is idle", () => {
    const items = groupTurns([user("u1", 1), assistant("a1", "u1", 2, { time: { created: 2 } })])
    expect(nextLiveItemKey("turn:u1", false, items)).toBe("")
  })

  it("does not keep a finished compaction live through the latch", () => {
    const compactUser = user("compact", 1)
    const done = assistant("summary", "compact", 2)
    const parts: Record<string, Part[]> = {
      compact: [{ id: "p1", sessionID: "s1", messageID: "compact", type: "compaction" }],
    }
    const items = groupTurns([compactUser, done], parts)
    expect(nextLiveItemKey("compaction:compact", true, items)).toBe("")
  })

  it("keys compactions by user id so appended turns do not move them", () => {
    const compactUser = user("compact", 1)
    const parts: Record<string, Part[]> = {
      compact: [{ id: "p1", sessionID: "s1", messageID: "compact", type: "compaction" }],
    }
    const before = groupTurns([user("u1", 0), compactUser], parts)
    const after = groupTurns([user("u1", 0), compactUser, user("u2", 3)], parts)
    const compactionBefore = before.find((entry) => entry.kind === "compaction")
    const compactionAfter = after.find((entry) => entry.kind === "compaction")
    expect(compactionBefore && timelineItemKey(compactionBefore, before.indexOf(compactionBefore))).toBe(
      "compaction:compact",
    )
    expect(compactionAfter && timelineItemKey(compactionAfter, after.indexOf(compactionAfter))).toBe(
      "compaction:compact",
    )
  })
})
