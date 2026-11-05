import { describe, expect, it } from "vitest"
import { groupEntries } from "./step-grouping"
import type { ConversationEntry } from "./conversation"
import type { Part, ToolPart } from "./types"

function entry(part: Part): ConversationEntry {
  return { kind: "part", key: part.id, part }
}
function tool(id: string, name: string, input: Record<string, unknown> = {}, status: ToolPart["state"]["status"] = "completed"): Part {
  return { id, sessionID: "s", messageID: "a", type: "tool", tool: name, callID: id, state: { status, input, output: "ok" } } as ToolPart
}
function text(id: string, value: string): Part {
  return { id, sessionID: "s", messageID: "a", type: "text", text: value }
}

describe("step grouping", () => {
  it.each(["compact-all-grouped", "compact-grouped", "compact-ungrouped", "compact-shells", "detailed"] as const)("uses every narration as a work boundary at %s density", (density) => {
    const blocks = groupEntries([
      entry(text("intro", "先检查")),
      entry(tool("r1", "read", { filePath: "a.ts" })),
      entry(tool("g1", "grep", { pattern: "TODO" })),
      entry(text("progress", "找到原因，开始修复")),
      entry(tool("e1", "edit", { filePath: "a.ts" })),
      entry(text("check", "接下来验证")),
      entry(tool("s1", "shell", { command: "bun test" })),
    ], density)
    expect(blocks.map((block) => [block.kind, block.key])).toEqual([
      ["content", "content:intro"], ["work", "work:r1"],
      ["content", "content:progress"], ["work", "work:e1"],
      ["content", "content:check"], ["work", "work:s1"],
    ])
    expect(blocks[1].entries.map((entry) => entry.key)).toEqual(["r1", "g1"])
  })

  it("keeps consecutive short text parts visible instead of folding them into work", () => {
    const blocks = groupEntries([entry(text("a", "one")), entry(text("b", "two")), entry(text("c", "three"))])
    expect(blocks.map((block) => block.kind)).toEqual(["content", "content", "content"])
  })

  it("splits operation types even at compact density", () => {
    const steps = [
      entry(tool("r1", "read", { filePath: "a.ts" })),
      entry(tool("s1", "bash", { command: "bun test" })),
      entry(tool("e1", "edit", { filePath: "a.ts" })),
    ]
    expect(groupEntries(steps, "compact-all-grouped").map((block) => block.key)).toEqual(["work:r1", "work:s1", "work:e1"])
    expect(groupEntries(steps, "compact-ungrouped").map((block) => [block.key, block.shape])).toEqual([
      ["work:r1", "group"],
      ["work:s1", "single"],
      ["work:e1", "single"],
    ])
    expect(groupEntries(steps, "detailed").find((block) => block.key === "work:s1")?.shape).toBe("card")
  })

  it("keeps consecutive operations together across messages and reasoning without narration", () => {
    const thought = (id: string): ConversationEntry => entry({ id, type: "reasoning", text: "checking", sessionID: "s", messageID: id })
    const steps = [
      entry(tool("r1", "read")), thought("thought1"), entry({ ...tool("r2", "grep"), messageID: "a2" }),
      thought("thought2"), entry(tool("e1", "edit")), entry(tool("e2", "write")),
      thought("thought3"), entry(tool("s1", "shell")), entry(tool("s2", "shell")),
      entry(tool("r3", "read")),
    ]
    const blocks = groupEntries(steps)
    expect(blocks.map((block) => block.key)).toEqual(["work:r1", "work:e1", "work:s1", "work:r3"])
    expect(blocks.flatMap((block) => block.entries)).toEqual(steps)
    expect(blocks.map((block) => block.entries.filter((e) => e.kind === "part" && e.part.type === "tool").length)).toEqual([2, 2, 2, 1])
  })

  it("makes a browser group only after two browser tools", () => {
    const one = groupEntries([entry(tool("w1", "websearch", { query: "coda" }))])
    expect(one[0]?.shape).toBe("group")
    const two = groupEntries([
      entry(tool("w1", "websearch", { query: "coda" })),
      entry(tool("w2", "webfetch", { url: "https://example.com" })),
    ])
    expect(two[0]?.shape).toBe("browser-group")
    expect(two[0]?.key).toBe("work:w1")
  })

  it("leaves an edit that is waiting for approval on its own row", () => {
    const pending = tool("e1", "edit", { filePath: "a.ts" }, "pending") as ToolPart
    pending.state = { status: "pending", input: { filePath: "a.ts" }, metadata: { needsApproval: true } } as ToolPart["state"]
    const blocks = groupEntries([entry(tool("r1", "read", { filePath: "a.ts" })), entry(pending)])
    expect(blocks.map((block) => block.key)).toEqual(["work:r1", "work:e1"])
  })
})
