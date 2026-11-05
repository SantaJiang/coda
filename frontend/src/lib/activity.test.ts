import { conversationBlocks } from "./conversation"
import { describe, expect, it } from "vitest"
import {
  activityDiff,
  activityFailureCount,
  activityStatus,
  activitySummary,
  changedFiles,
  formatDuration,
  stepPresentation,
  terminalDisplayTitle,
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
  it("uses the server check deadline when present", () => {
    const waiting = tool("wait", "shell_wait", { timeout: 120000 }, {
      status: "running", metadata: { nextCheckAt: 1_700_000_090_000 },
    })
    expect(activityStatus([waiting], 1_700_000_000_000)).toBe("Waiting up to 1m 30s for shell")
    expect(activityStatus([waiting], 1_700_000_100_000)).toBe("Waiting up to 0m 0s for shell")
    const running = tool("run", "bash", { command: "bun install", timeout: 120000 }, {
      status: "running",
      time: { start: 1_700_000_000_000 },
    })
    expect(activityStatus([running], 1_700_000_000_000)).not.toContain("Waiting")
  })

  it("uses ordinary command activity during the short initial wait", () => {
    const start = 1_700_000_000_000
    const command = tool("short", "bash", { command: "git status" }, { status: "running", metadata: { terminalStartedAt: start, nextCheckAt: start + 30000 } })
    expect(activityStatus([command], start + 9999)).not.toContain("Waiting up to")
    expect(activityStatus([command], start + 10000)).toBe("Waiting up to 0m 20s for shell")
  })

  it("falls back to the tool timeout so silent waits are not blank Planning next moves", () => {
    const start = 1_700_000_000_000
    const waiting = tool(
      "device",
      "shell",
      { command: "for i in $(seq 1 40); do sleep 15; done", timeout: 720_000 },
      { status: "running", time: { start }, metadata: { terminalStartedAt: start } },
    )
    expect(activityStatus([waiting], start + 9_999)).toMatch(/^Running /)
    expect(activityStatus([waiting], start + 10_000)).toBe("Waiting up to 11m 50s for shell")
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
    expect(conversationBlocks(parts.map((part) => ({ kind: "part", key: part.id, part }))).map((block) => block.key)).toEqual(["work:r1"])
  })

  it("shows accurate read ranges and search locations", () => {
    expect(stepPresentation(tool("r1", "read", { filePath: "/repo/a.ts", offset: 20, limit: 10 }))).toEqual(
      { action: "Read", detail: "a.ts L20-29" },
    )
    expect(
      stepPresentation(
        tool("r2", "read", { filePath: "/repo/a.ts", offset: 20, limit: 10 }, {
          metadata: { display: { lineStart: 20, lineEnd: 24 } },
        }),
      ),
    ).toEqual({ action: "Read", detail: "a.ts L20-24" })
    expect(stepPresentation(tool("g1", "glob", { pattern: "**/*.ts", path: "/repo/src" }))).toEqual(
      { action: "Searched files", detail: "**/*.ts", context: "in src" },
    )
    expect(stepPresentation(tool("g2", "glob", { pattern: "**/*.ts", target_directory: "/repo/src" }))).toEqual(
      { action: "Searched files", detail: "**/*.ts", context: "in src" },
    )
  })

  it("surfaces failed steps and completed questions", () => {
    const failed = tool("r1", "read", { filePath: "/repo/missing.ts" }, { status: "error", error: "missing" })
    expect(activityFailureCount([failed])).toBe(1)
    expect(stepPresentation(tool("q1", "question", { questions: [{ header: "图标范围" }] }))).toEqual(
      { action: "Asked", detail: "图标范围" },
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
      detail: "Run tests",
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
    expect(stepPresentation(reasoning)).toEqual({ action: "Thought", detail: "briefly" })
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

  it("reads the v2 file diff entries behind changed files and their counts", () => {
    const edit = tool("e1", "edit", { path: "/repo/a.ts" }, {
      metadata: { files: [
        { file: "/repo/a.ts", patch: "@@ -1 +1 @@\n-old\n+new", status: "modified", additions: 2, deletions: 1 },
      ] },
    })
    expect(changedFiles([edit])).toEqual([
      { path: "/repo/a.ts", name: "a.ts", added: 2, removed: 1, patch: "@@ -1 +1 @@\n-old\n+new" },
    ])
    expect(activityDiff([edit])).toEqual({ added: 2, removed: 1 })
  })

  it("keeps every file of a multi-file patch call and merges repeated edits", () => {
    const patch = tool("p1", "patch", {}, {
      metadata: { files: [
        { file: "src/a.ts", patch: "@@ -1 +1 @@\n-a\n+b", additions: 1, deletions: 1 },
        { file: "src/b.ts", patch: "@@ -1 +1 @@\n-c\n+d", additions: 1, deletions: 1 },
      ] },
    })
    const again = tool("p2", "patch", {}, {
      metadata: { files: [{ file: "src/a.ts", patch: "@@ -3 +3 @@\n-e\n+f", additions: 1, deletions: 1 }] },
    })
    expect(changedFiles([patch, again]).map((file) => [file.path, file.added, file.removed])).toEqual([
      ["src/a.ts", 2, 2],
      ["src/b.ts", 1, 1],
    ])
    expect(activityDiff([patch, again])).toEqual({ added: 3, removed: 3 })
  })

  it("keeps completed to-do checks in step history without adding a summary category", () => {
    const todo = tool("todo-1", "todowrite", { todos: [] })
    expect(activitySummary([todo])).toBe("Checked to-do list")
    expect(stepPresentation(todo)).toEqual({ action: "Checked", detail: "to-do list" })
    expect(activitySummary([todo, tool("r1", "read", { filePath: "/repo/a.ts" })])).toBe(
      "Explored 1 file",
    )
  })

  it("labels long shell tasks without dumping raw argv", () => {
    expect(terminalDisplayTitle("bun run tauri dev", "Launch Coda Tauri desktop app in dev mode")).toBe(
      "Launch Coda Tauri desktop app in dev mode",
    )
    expect(terminalDisplayTitle("chmod +x /tmp/omnibox_autobuild.sh && /tmp/omnibox_autobuild.sh")).toBe(
      "Prepare script",
    )
    expect(terminalDisplayTitle("pkill -f 'xcodebuild -downloadComponent'; sleep 3")).toBe(
      "Stop background process",
    )
    expect(terminalDisplayTitle("p1=$(tr '\\r' '\\n' < /tmp/metal_dl4.log | tail -5)")).toBe("Inspect output")
    expect(stepPresentation(tool("sh", "shell", { command: "pkill -f xcodebuild" }))).toEqual({
      action: "Ran",
      detail: "Stop background process",
    })
  })
})
