import type { Part, ReasoningPart, ToolPart } from "./types"

export type ActivityBlock =
  | { kind: "work"; parts: Part[] }
  | { kind: "answer"; parts: Part[] }

export function groupActivityBlocks(parts: Part[]): ActivityBlock[] {
  const blocks: ActivityBlock[] = []
  for (const part of parts) {
    const kind = part.type === "tool" || part.type === "reasoning" ? "work" : "answer"
    const last = blocks[blocks.length - 1]
    if (last && last.kind === kind) last.parts.push(part)
    else blocks.push({ kind, parts: [part] })
  }
  return blocks
}

function toolPath(part: ToolPart) {
  const input = part.state.input
  if (!input) return ""
  const value = input.path ?? input.file_path ?? input.command ?? input.pattern ?? input.url ?? input.query
  return value ? String(value) : ""
}

type Bucket = "edit" | "explore" | "search" | "browser" | "command"

function bucketOf(tool: string): Bucket {
  const name = tool.toLowerCase()
  if (name === "edit" || name === "write") return "edit"
  if (name === "read" || name === "glob" || name === "list" || name === "ls") return "explore"
  if (name === "grep") return "search"
  if (name === "webfetch" || name === "websearch") return "browser"
  return "command"
}

function plural(n: number, one: string, many: string) {
  return n === 1 ? one : many
}

export function activitySummary(parts: Part[]) {
  const tools = parts.filter((part): part is ToolPart => part.type === "tool")
  if (tools.length === 0) return ""

  const files = {
    edit: new Set<string>(),
    explore: new Set<string>(),
  }
  const counts = { edit: 0, explore: 0, search: 0, browser: 0, command: 0 }

  for (const part of tools) {
    const bucket = bucketOf(part.tool)
    const path = toolPath(part)
    if (bucket === "edit") {
      if (path) files.edit.add(path)
      else counts.edit += 1
    } else if (bucket === "explore") {
      if (path) files.explore.add(path)
      else counts.explore += 1
    } else {
      counts[bucket] += 1
    }
  }

  const edit = files.edit.size || counts.edit
  const explore = files.explore.size || counts.explore
  const bits: string[] = []
  if (edit) bits.push(plural(edit, "Editing 1 file", `Editing ${edit} files`))
  if (explore) bits.push(plural(explore, "explored 1 file", `explored ${explore} files`))
  if (counts.search) bits.push(plural(counts.search, "1 search", `${counts.search} searches`))
  if (counts.browser) bits.push(plural(counts.browser, "1 browser action", `${counts.browser} browser actions`))
  if (counts.command) bits.push(plural(counts.command, "ran 1 command", `ran ${counts.command} commands`))
  return bits.join(", ")
}

function labelForBucket(bucket: Bucket) {
  if (bucket === "edit") return "Editing"
  if (bucket === "explore" || bucket === "search") return "Exploring"
  if (bucket === "browser") return "Browsing"
  return "Running"
}

export function activityFlip(parts: Part[]) {
  const tools = parts.filter((part): part is ToolPart => part.type === "tool")
  const running = [...tools].reverse().find(
    (part) => part.state.status === "pending" || part.state.status === "running",
  )
  if (running) return labelForBucket(bucketOf(running.tool))
  const latest = tools[tools.length - 1]
  if (latest) return labelForBucket(bucketOf(latest.tool))
  if (parts.some((part) => part.type === "reasoning" && (part as ReasoningPart).text)) return "Thinking"
  return "Planning next moves"
}
