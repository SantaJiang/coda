import { describe, expect, it } from "vitest"
import {
  activityDiff,
  activityFailureCount,
  activityStatus,
  activitySummary,
  formatDuration,
  groupActivityBlocks,
  stepLabel,
  stepPresentation,
} from "./activity"
import type { Part, ToolPart } from "./types"

function tool(
  id: string,
  name: string,
  input: Record<string, unknown> = {},
  over: Partial<ToolPart["state"]> = {},
): ToolPart {
  return {
    id,
    sessionID: "s1",
    messageID: "a1",
    type: "tool",
    callID: `call-${id}`,
    tool: name,
    state: { status: "completed", input, output: "ok", ...over },
  } as ToolPart
}

describe("activity presentation", () => {
  it("uses the server check deadline without treating the execution timeout as a wait estimate", () => {
    const waiting = tool("wait", "shell_wait", { timeout: 120000 }, {
      status: "running", metadata: { nextCheckAt: 1_700_000_010_000 },
    })
    expect(activityStatus([waiting], 1_700_000_000_000)).toBe("Waiting for shell 10s")
    expect(activityStatus([waiting], 1_700_000_020_000)).toBe("Waiting for shell 0s")
    const running = tool("run", "bash", { command: "bun install", timeout: 120000 }, { status: "running" })
    expect(activityStatus([running], 1_700_000_000_000)).not.toContain("Waiting")
  })

  it("separates file reads from searches and keeps other action counts", () => {
    const parts: Part[] = [
      tool("r1", "read", { filePath: "/repo/a.ts" }),
      tool("r2", "read", { filePath: "/repo/a.ts" }),
      tool("r3", "read", { filePath: "/repo/b.ts" }),
      tool("g1", "glob", { pattern: "**/*.ts" }),
      tool("g2", "grep", { pattern: "TODO" }),
      tool("l1", "list", { path: "/repo/src" }),
      tool("b1", "bash", { command: "npm test" }),
      tool("q1", "question", { questions: [{ header: "范围" }] }),
    ]

    expect(activitySummary(parts)).toBe("Explored 2 files, 3 searches, ran 1 command, asked 1 question")
  })

  it("uses stable block keys based on the first part", () => {
    const parts: Part[] = [
      tool("r1", "read"),
      { id: "t1", sessionID: "s1", messageID: "a1", type: "text", text: "progress" },
      tool("r2", "grep"),
    ]
    expect(groupActivityBlocks(parts).map((block) => block.key)).toEqual(["work:r1", "answer:t1", "work:r2"])
  })

  it("shows accurate read ranges and search locations", () => {
    expect(stepLabel(tool("r1", "read", { filePath: "/repo/a.ts", offset: 20, limit: 10 }))).toBe(
      "Read a.ts L20-29",
    )
    expect(
      stepLabel(
        tool("r2", "read", { filePath: "/repo/a.ts", offset: 20, limit: 10 }, {
          metadata: { display: { lineStart: 20, lineEnd: 24 } },
        }),
      ),
    ).toBe("Read a.ts L20-24")
    expect(stepLabel(tool("g1", "glob", { pattern: "**/*.ts", path: "/repo/src" }))).toBe(
      "Searched files **/*.ts in src",
    )
    expect(stepLabel(tool("g2", "glob", { pattern: "**/*.ts", target_directory: "/repo/src" }))).toBe(
      "Searched files **/*.ts in src",
    )
  })

  it("surfaces failed steps and completed questions", () => {
    const failed = tool("r1", "read", { filePath: "/repo/missing.ts" }, { status: "error", error: "missing" })
    expect(activityFailureCount([failed])).toBe(1)
    expect(stepLabel(tool("q1", "question", { questions: [{ header: "图标范围" }] }))).toBe(
      "Asked 图标范围",
    )
  })

  it("shows completed reasoning duration instead of a vague length label", () => {
    const reasoning: Part = {
      id: "thought-1",
      sessionID: "s1",
      messageID: "a1",
      type: "reasoning",
      text: "short reasoning",
      time: { start: 1_000, end: 3_400 },
    }

    expect(activitySummary([reasoning])).toBe("Thought 2s")
    expect(stepPresentation(reasoning)).toEqual({ action: "Thought", detail: "2s" })
    expect(formatDuration(67_000)).toBe("1m 7s")
  })

  it("keeps the action, detail, and location as separate visual fields", () => {
    expect(stepPresentation(tool("g1", "grep", { pattern: "SessionStatus", path: "/repo/src" }))).toEqual({
      action: "Grepped",
      detail: "SessionStatus",
      context: "in src",
    })
    expect(stepPresentation(tool("b1", "bash", { command: "npm test" }))).toEqual({
      action: "Ran",
      detail: "tests",
    })
  })

  it("still shows a minimum duration for a completed sub-second thought", () => {
    const reasoning: Part = {
      id: "thought-fast",
      sessionID: "s1",
      messageID: "a1",
      type: "reasoning",
      text: "done",
      time: { start: 1_000, end: 1_000 },
    }
    expect(stepLabel(reasoning)).toBe("Thought 1s")
  })

  it("returns to thinking when reasoning starts after a completed tool", () => {
    const completedTool = tool("r1", "read", { filePath: "/repo/a.ts" })
    const runningReasoning: Part = {
      id: "thought-running",
      sessionID: "s1",
      messageID: "a1",
      type: "reasoning",
      text: "next step",
      time: { start: 4_000 },
    }
    const completedReasoning: Part = {
      ...runningReasoning,
      time: { start: 4_000, end: 5_000 },
    }

    expect(activityStatus([])).toBe("Planning next moves")
    expect(activityStatus([completedTool])).toBe("Planning next moves")
    expect(activityStatus([completedTool, runningReasoning])).toBe("Thinking")
    expect(activityStatus([completedTool, completedReasoning])).toBe("Thought")
  })

  it("does not count a trailing newline as an extra written line", () => {
    expect(activityDiff([tool("w1", "write", { filePath: "/repo/a.ts", content: "hello\n" })])).toEqual({
      added: 1,
      removed: 0,
    })
  })

  it("keeps completed to-do checks in step history without adding a summary category", () => {
    const todo = tool("todo-1", "todowrite", { todos: [] })
    expect(activitySummary([todo])).toBe("Checked to-do list")
    expect(stepPresentation(todo)).toEqual({ action: "Checked", detail: "to-do list" })
    expect(activitySummary([todo, tool("r1", "read", { filePath: "/repo/a.ts" })])).toBe(
      "Explored 1 file",
    )
  })
})
