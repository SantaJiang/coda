import { describe, expect, it } from "vitest"
import { groupEntries, proseCanGroup } from "./step-grouping"
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
  it("keeps long prose and fenced prose on their own row", () => {
    expect(proseCanGroup("short note")).toBe(true)
    expect(proseCanGroup("x".repeat(101))).toBe(false)
    expect(proseCanGroup("```ts\nconst a = 1\n```")).toBe(false)
    expect(proseCanGroup("# Title")).toBe(false)
  })

  it("joins short prose with tools in compact and forces three short lines before a text-only group", () => {
    const mixed = groupEntries([
      entry(tool("r1", "read", { filePath: "a.ts" })),
      entry(text("t1", "checking")),
      entry(tool("g1", "grep", { pattern: "TODO" })),
    ])
    expect(mixed.map((block) => block.key)).toEqual(["work:r1"])
    const shorts = groupEntries([entry(text("a", "one")), entry(text("b", "two"))])
    expect(shorts.map((block) => block.shape)).toEqual(["single", "single"])
    const grouped = groupEntries([entry(text("a", "one")), entry(text("b", "two")), entry(text("c", "three"))])
    expect(grouped.map((block) => block.shape)).toEqual(["group"])
  })

  it("splits shell from edits unless the density is compact", () => {
    const steps = [
      entry(tool("r1", "read", { filePath: "a.ts" })),
      entry(tool("s1", "bash", { command: "bun test" })),
      entry(tool("e1", "edit", { filePath: "a.ts" })),
    ]
    expect(groupEntries(steps, "compact-all-grouped").map((block) => block.key)).toEqual(["work:r1"])
    expect(groupEntries(steps, "compact-ungrouped").map((block) => [block.key, block.shape])).toEqual([
      ["work:r1", "group"],
      ["work:s1", "single"],
      ["work:e1", "single"],
    ])
    expect(groupEntries(steps, "detailed").find((block) => block.key === "work:s1")?.shape).toBe("card")
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
