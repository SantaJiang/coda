import { describe, expect, it } from "vitest"
import { conversationTurns } from "../lib/conversation"
import type { AssistantMessage, Message, Part, SessionStatus, ToolPart, UserMessage } from "../lib/types"

const user = (id = "u1", created = 1): UserMessage => ({ id, role: "user", sessionID: "s1", time: { created } })
const assistant = (id = "a1", parentID = "u1", created = 2, patch: Partial<AssistantMessage> = {}): AssistantMessage => ({ id, role: "assistant", sessionID: "s1", parentID, time: { created }, ...patch })
const text = (id: string, value: string, messageID = "a1"): Part => ({ id, type: "text", text: value, messageID, sessionID: "s1" })
const tool = (id = "tool1", status: ToolPart["state"]["status"] = "completed", messageID = "a1"): Part => ({ id, type: "tool", tool: "read", callID: id, state: { status, input: { filePath: "src/app.ts" } }, messageID, sessionID: "s1" } as ToolPart)
const done = (id = "a1", parentID = "u1", created = 2) => assistant(id, parentID, created, { time: { created, completed: created + 1 }, finish: "stop" })
const project = (messages: Message[], parts: Record<string, Part[]> = {}, status: SessionStatus = { type: "idle" }, context = {}) => conversationTurns(messages, parts, { status, ...context })

describe("conversation event sequences", () => {
  it("keeps a completed model step active until the session ends", () => {
    const messages = [user(), assistant("a1", "u1", 2, { finish: "tool-calls", time: { created: 2, completed: 3 } })]
    const turn = project(messages, { a1: [text("p1", "先读文件"), tool()] }, { type: "busy" })[0]
    expect(turn.phase).toBe("running")
    expect(turn.answer).toEqual([])
    expect(turn.entries.map((entry) => entry.key)).toEqual(["a1:p1", "a1:tool1"])
  })

  it("keeps prose/tool/prose in order and only groups after reconciliation", () => {
    const messages = [user(), done("a1"), done("a2", "u1", 4)]
    const parts = { a1: [text("p1", "先检查"), tool(), text("p2", "再检查")], a2: [tool("tool2", "completed", "a2"), text("p3", "最终结论", "a2")] }
    const running = project(messages, parts, { type: "busy" })[0]
    expect(running.entries.map((entry) => entry.key)).toEqual(["a1:p1", "a1:tool1", "a1:p2", "a2:tool2", "a2:p3"])
    expect(project(messages, parts, { type: "idle" }, { settling: true })[0].phase).toBe("settling")
    const finished = project(messages, parts)[0]
    expect(finished.phase).toBe("done")
    expect(finished.answer.map((entry) => entry.key)).toEqual(["a2:p3"])
    expect(finished.process).toHaveLength(4)
  })

  it("keeps a pure prose reply outside an empty process summary", () => {
    const turn = project([user(), done()], { a1: [text("p1", "回答"), text("p2", "补充")] })[0]
    expect(turn.process).toEqual([])
    expect(turn.answer).toHaveLength(2)
  })

  it("does not promote earlier narration when tools finish without final prose", () => {
    const turn = project([user(), done()], { a1: [text("p1", "我来修改"), tool()] })[0]
    expect(turn.phase).toBe("done")
    expect(turn.answer).toEqual([])
    expect(turn.process).toHaveLength(2)
  })

  it("does not use a prior assistant's prose as the final answer", () => {
    const turn = project([user(), done(), done("a2", "u1", 4)], { a1: [tool(), text("p1", "继续处理")], a2: [] })[0]
    expect(turn.answer).toEqual([])
  })

  it("keeps parallel operations visible and counts recovered tool failures", () => {
    const messages = [user(), assistant()]
    const running = project(messages, { a1: [tool("t1", "running"), tool("t2", "pending")] }, { type: "busy" })[0]
    expect(running.label).toContain("2 项运行中")
    const finished = project([user(), done()], { a1: [tool("t1", "error"), tool("t2"), text("p1", "已恢复")] })[0]
    expect(finished.phase).toBe("done")
    expect(finished.failures).toBe(1)
    expect(finished.summary).toContain("1 项失败")
  })

  it("prioritizes blockers and stopping over normal activity and retry", () => {
    const messages = [user(), assistant()]
    const status: SessionStatus = { type: "retry", attempt: 2, next: 5000 }
    expect(project(messages, {}, status, { permissionCount: 1 })[0].label).toBe("Waiting for permission")
    expect(project(messages, {}, status, { questionCount: 1 })[0].label).toBe("Asking questions")
    expect(project(messages, {}, status, { stopping: true })[0].label).toBe("Stopping")
    expect(project(messages, {}, status, { now: 3000 })[0].label).toBe("Retrying in 2s · attempt 2")
  })

  it("preserves output on failure, stop and interrupted legacy history", () => {
    for (const [patch, expected] of [
      [{ error: { name: "APIError", data: { message: "provider down" } } }, "failed"],
      [{ error: { name: "MessageAbortedError", data: { message: "Aborted" } } }, "stopped"],
      [{ finish: "tool-calls", time: { created: 2, completed: 3 } }, "interrupted"],
    ] as const) {
      const turn = project([user(), assistant("a1", "u1", 2, patch)], { a1: [text("p1", "partial")] })[0]
      expect(turn.phase).toBe(expected)
      expect(turn.entries).toHaveLength(1)
      expect(turn.answer).toEqual([])
    }
  })

  it("uses parent IDs even when updates arrive after a newer user", () => {
    const turns = project([user(), user("u2", 4), done("a1", "u1", 5), done("a2", "u2", 6)])
    expect(turns.map((turn) => turn.assistants.map((message) => message.id))).toEqual([["a1"], ["a2"]])
  })

  it("never attaches an unavailable parent to an unrelated user", () => {
    const turns = project([user(), done("a1", "missing")])
    expect(turns.find((turn) => turn.id === "u1")?.assistants).toEqual([])
    expect(turns.find((turn) => turn.id === "orphan:missing")?.assistants).toHaveLength(1)
  })

  it("keeps compaction inside the same round and excludes its summary from the answer", () => {
    const compact = user("c1", 3)
    const messages = [user(), done(), compact, assistant("summary", "c1", 4, { summary: true, time: { created: 4, completed: 5 } }), done("a2", "u1", 6)]
    const parts: Record<string, Part[]> = { c1: [{ id: "cp", type: "compaction", sessionID: "s1", messageID: "c1" }], summary: [text("sp", "内部摘要", "summary")], a2: [text("p1", "真正回复", "a2")] }
    const turns = project(messages, parts)
    expect(turns).toHaveLength(1)
    expect(turns[0].process[0]).toMatchObject({ kind: "compaction", status: "done", summary: "内部摘要" })
    expect(turns[0].answer.map((entry) => entry.key)).toEqual(["a2:p1"])
  })

  it("marks unfinished compaction interrupted after confirmed idle", () => {
    const turns = project([user(), user("c1", 3)], { c1: [{ id: "cp", type: "compaction", messageID: "c1", sessionID: "s1" }] })
    expect(turns[0].entries[0]).toMatchObject({ kind: "compaction", status: "interrupted" })
  })

  it("shows optimistic delivery failure without creating a second round", () => {
    const turn = project([{ ...user(), delivery: "failed", deliveryError: "offline" }])[0]
    expect(turn.phase).toBe("failed")
    expect(turn.user?.deliveryError).toBe("offline")
  })
})
