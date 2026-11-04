import { describe, expect, it } from "vitest"
import {
  childSessionStub,
  isSubagentTool,
  runningSubagentActivities,
  subagentActivities,
  subagentDescription,
  subagentSessionID,
} from "./subagent"
import type { MessageWithParts, ToolPart } from "./types"

function tool(partial: Partial<ToolPart> & Pick<ToolPart, "id" | "tool" | "state">): ToolPart {
  return {
    type: "tool",
    sessionID: "parent",
    messageID: "m1",
    callID: partial.id,
    ...partial,
  }
}

describe("subagent helpers", () => {
  it("recognizes subagent and task tools", () => {
    expect(isSubagentTool(tool({ id: "1", tool: "subagent", state: { status: "running", input: {} } }))).toBe(true)
    expect(isSubagentTool(tool({ id: "2", tool: "task", state: { status: "running", input: {} } }))).toBe(true)
    expect(isSubagentTool(tool({ id: "3", tool: "bash", state: { status: "running", input: {} } }))).toBe(false)
  })

  it("reads description and session id from input/metadata/output", () => {
    const running = tool({
      id: "1",
      tool: "subagent",
      state: {
        status: "running",
        input: { description: "explore UI", agent: "explore" },
        metadata: { sessionID: "ses_child" },
      },
    })
    expect(subagentDescription(running)).toBe("explore UI")
    expect(subagentSessionID(running)).toBe("ses_child")

    const done = tool({
      id: "2",
      tool: "task",
      state: {
        status: "completed",
        input: { description: "done task" },
        output: 'summary\n<subagent sessionID="ses_done" />\n',
        title: "ignored",
        metadata: {},
        time: { start: 1, end: 2 },
      },
    })
    expect(subagentSessionID(done)).toBe("ses_done")
  })

  it("lists activities for dock chips", () => {
    const messages: MessageWithParts[] = [
      {
        info: { id: "m1", sessionID: "parent", role: "assistant", time: { created: 10 }, parentID: "u1" },
        parts: [
          tool({
            id: "p1",
            tool: "subagent",
            state: {
              status: "running",
              input: { description: "explore Cursor", agent: "explore" },
              metadata: { sessionID: "ses_x" },
              time: { start: 11 },
            },
          }),
        ],
      },
    ]
    expect(subagentActivities(messages)).toEqual([
      {
        key: "p1",
        sessionID: "ses_x",
        label: "explore Cursor",
        agent: "explore",
        started: 11,
        running: true,
      },
    ])
    expect(runningSubagentActivities(messages)).toHaveLength(1)
  })

  it("hides completed subagent chips from the live dock", () => {
    const messages: MessageWithParts[] = [
      {
        info: { id: "m1", sessionID: "parent", role: "assistant", time: { created: 10 }, parentID: "u1" },
        parts: [
          tool({
            id: "p1",
            tool: "subagent",
            state: {
              status: "completed",
              input: { description: "探索附件处理逻辑", agent: "explore" },
              output: "done",
              title: "探索附件处理逻辑",
              metadata: { sessionID: "ses_x" },
              time: { start: 11, end: 20 },
            },
          }),
          tool({
            id: "p2",
            tool: "subagent",
            state: {
              status: "running",
              input: { description: "仍在跑", agent: "explore" },
              metadata: { sessionID: "ses_y" },
              time: { start: 21 },
            },
          }),
        ],
      },
    ]
    expect(subagentActivities(messages)).toHaveLength(2)
    expect(runningSubagentActivities(messages)).toEqual([
      {
        key: "p2",
        sessionID: "ses_y",
        label: "仍在跑",
        agent: "explore",
        started: 21,
        running: true,
      },
    ])
  })

  it("builds a selectable child stub", () => {
    const stub = childSessionStub({
      id: "ses_c",
      directory: "/repo",
      title: "explore",
      parentID: "ses_p",
      agent: "explore",
    })
    expect(stub).toMatchObject({
      id: "ses_c",
      directory: "/repo",
      title: "explore",
      parentID: "ses_p",
      agent: "explore",
    })
  })
})
