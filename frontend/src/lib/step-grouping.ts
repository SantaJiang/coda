import { activitySummary, stepPresentation } from "./activity"
import type { ConversationDensity } from "./density"
import type { ConversationEntry } from "./conversation"
import type { ToolPart } from "./types"

export type BlockShape = "group" | "browser-group" | "waiting-group" | "single" | "card"
export type ConversationBlock = {
  kind: "work" | "content" | "system"
  key: string
  entries: ConversationEntry[]
  shape: BlockShape
}

const ALWAYS = new Set([
  "read", "grep", "glob", "ls", "list", "semsearch", "searchconversations",
  "readlints", "readtodos", "fetch", "webfetch", "websearch", "getmcptools", "generateimage",
])
const SHELL = new Set(["bash", "shell", "shell_status", "shell_cancel"])
const EDIT = new Set(["edit", "write", "multiedit", "apply_patch", "applypatch"])
const DELETE = new Set(["delete", "remove"])
const BROWSER = new Set(["webfetch", "websearch"])
const WAITING = new Set(["shell_wait", "await"])

type Family = "explore" | "shell" | "edit" | "delete" | "browser" | "waiting" | "thinking" | "text" | "blocked"

function nameOf(tool: ToolPart) {
  return tool.tool.toLowerCase()
}

function pathOf(tool: ToolPart) {
  const input = tool.state.input ?? {}
  return String(input.filePath ?? input.file_path ?? input.path ?? input.target_file ?? input.targetFile ?? input.file ?? "").trim()
}

function needsApproval(tool: ToolPart) {
  const meta = "metadata" in tool.state ? tool.state.metadata : undefined
  return Boolean(meta && typeof meta === "object" && "needsApproval" in meta && (meta as { needsApproval?: boolean }).needsApproval)
}

function classify(entry: ConversationEntry, density: ConversationDensity): { entry: ConversationEntry; family: Family; groupable: boolean } {
  if (entry.kind === "compaction") return { entry, family: "blocked", groupable: false }
  const part = entry.part
  if (part.type === "reasoning") return { entry, family: "thinking", groupable: true }
  if (part.type === "text") return { entry, family: "text", groupable: false }
  if (part.type !== "tool") return { entry, family: "blocked", groupable: false }
  if (needsApproval(part)) return { entry, family: "blocked", groupable: false }
  const name = nameOf(part)
  if (WAITING.has(name) || name.includes("await")) return { entry, family: "waiting", groupable: true }
  if (BROWSER.has(name) || name.includes("browser")) return { entry, family: "browser", groupable: true }
  const rich = density === "compact-grouped" || density === "compact-all-grouped"
  if (SHELL.has(name)) return { entry, family: "shell", groupable: rich }
  if (DELETE.has(name)) return { entry, family: "delete", groupable: rich }
  if (EDIT.has(name)) {
    const settled = part.state.status === "completed" || part.state.status === "error"
    return { entry, family: "edit", groupable: rich && Boolean(pathOf(part) || settled) }
  }
  if (ALWAYS.has(name) || name.includes("lint") || name === "todowrite" || name === "todo" || name === "question" || name === "task" || name === "skill") {
    return { entry, family: "explore", groupable: true }
  }
  return { entry, family: "explore", groupable: density === "compact-all-grouped" }
}

function boundary(family: Family) {
  return family === "shell" || family === "edit" || family === "delete"
}

function compatible(buf: Array<{ family: Family }>, next: Family, density: ConversationDensity) {
  if (!buf.length) return true
  const families = new Set(buf.map((item) => item.family))
  const soft = (family: Family) => family === "text" || family === "thinking"
  if (families.has("browser") || next === "browser") {
    return next === "browser" || (soft(next) && [...families].every((family) => family === "browser" || soft(family)))
  }
  if (families.has("waiting") || next === "waiting") {
    return next === "waiting" || (soft(next) && [...families].every((family) => family === "waiting" || soft(family)))
  }
  if (density === "compact-all-grouped" || soft(next)) return true
  if (boundary(next)) {
    const current = [...families].find(boundary)
    if (current && current !== next) return false
    if (!current && [...families].some((family) => family === "explore")) return false
  } else if (next === "explore" && [...families].some(boundary)) return false
  return true
}

function shapeFor(buf: Array<{ family: Family }>): BlockShape {
  const families = new Set(buf.map((item) => item.family))
  const count = (family: Family) => buf.filter((item) => item.family === family).length
  if (families.has("browser") && count("browser") >= 2 && [...families].every((family) => family === "browser" || family === "text" || family === "thinking")) {
    return "browser-group"
  }
  if (families.has("waiting") && count("waiting") >= 2 && [...families].every((family) => family === "waiting" || family === "text" || family === "thinking")) {
    return "waiting-group"
  }
  return "group"
}

function singleBlock(entry: ConversationEntry, density: ConversationDensity): ConversationBlock {
  if (entry.kind === "compaction") return { kind: "system", key: `system:${entry.key}`, entries: [entry], shape: "single" }
  if (entry.kind === "part" && entry.part.type === "tool") {
    const name = nameOf(entry.part)
    const card = density === "detailed" && (SHELL.has(name) || (EDIT.has(name) && entry.part.state.status === "completed"))
    return { kind: "work", key: `work:${entry.key}`, entries: [entry], shape: card ? "card" : "single" }
  }
  return { kind: "content", key: `content:${entry.key}`, entries: [entry], shape: "single" }
}

/** Narration separates consecutive work batches at every density, live and in history. */
export function groupEntries(entries: ConversationEntry[], density: ConversationDensity = "compact-all-grouped"): ConversationBlock[] {
  const blocks: ConversationBlock[] = []
  let buf: Array<{ entry: ConversationEntry; family: Family }> = []
  const flush = () => {
    if (!buf.length) return
    const first = buf[0].entry
    blocks.push({ kind: "work", key: `work:${first.key}`, entries: buf.map((item) => item.entry), shape: shapeFor(buf) })
    buf = []
  }
  for (const entry of entries) {
    const item = classify(entry, density)
    if (!item.groupable) {
      flush()
      blocks.push(singleBlock(entry, density))
      continue
    }
    if (!compatible(buf, item.family, density)) flush()
    buf.push(item)
  }
  flush()
  return blocks
}

export function blockTitle(entries: ConversationEntry[], shape: BlockShape) {
  const parts = entries.flatMap((entry) => entry.kind === "part" ? [entry.part] : [])
  const tools = parts.filter((part): part is ToolPart => part.type === "tool")
  if (shape === "browser-group") return `Ran ${tools.length} browser ${tools.length === 1 ? "action" : "actions"}`
  if (shape === "waiting-group") return tools.length === 1 ? "Waiting for 1 background task" : `Waiting for ${tools.length} background tasks`
  if (shape === "single" || shape === "card") {
    const part = parts[0]
    if (!part) return ""
    const line = stepPresentation(part)
    return [line.action, line.detail, line.context].filter(Boolean).join(" ")
  }
  const summary = activitySummary(parts)
  const runningEdit = tools.some((tool) => EDIT.has(nameOf(tool)) && (tool.state.status === "pending" || tool.state.status === "running"))
  if (runningEdit && summary.startsWith("Edited")) return summary.replace(/^Edited/, "Editing")
  return summary || "Explored"
}

