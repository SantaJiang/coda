import type { AssistantMessage, Message, Part, ReasoningPart, ToolPart } from "./types"

export type ActivityBlock =
  | { kind: "work"; parts: Part[] }
  | { kind: "answer"; parts: Part[] }

export type ActivityDiff = {
  added: number
  removed: number
}

export type ChangedFile = {
  path: string
  name: string
  added: number
  removed: number
  patch?: string
}

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

export function splitProcessAndAnswer(blocks: ActivityBlock[]) {
  let lastWork = -1
  for (let index = 0; index < blocks.length; index++) {
    if (blocks[index].kind === "work") lastWork = index
  }
  if (lastWork < 0) return { process: [] as ActivityBlock[], answer: blocks }
  return {
    process: blocks.slice(0, lastWork + 1),
    answer: blocks.slice(lastWork + 1),
  }
}

export function isWorkLive(parts: Part[]) {
  return parts.some(
    (part) =>
      part.type === "tool" &&
      (part.state.status === "pending" || part.state.status === "running"),
  )
}

function toolPath(part: ToolPart) {
  const input = part.state.input
  if (!input) return ""
  const value =
    input.path ??
    input.file_path ??
    input.filePath ??
    input.target_file ??
    input.targetFile ??
    input.file ??
    input.command ??
    input.pattern ??
    input.glob ??
    input.url ??
    input.query
  return value ? String(value) : ""
}

type Bucket = "edit" | "explore" | "search" | "browser" | "command" | "lint"

function bucketOf(tool: string): Bucket {
  const name = tool.toLowerCase()
  if (
    name === "edit" ||
    name === "write" ||
    name === "multiedit" ||
    name === "apply_patch" ||
    name === "applypatch"
  ) {
    return "edit"
  }
  if (name === "read" || name === "glob" || name === "list" || name === "ls") return "explore"
  if (name === "grep") return "search"
  if (name.includes("lint")) return "lint"
  if (name === "webfetch" || name === "websearch") return "browser"
  return "command"
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function looksLikePath(value: string) {
  return /[\\/]/.test(value) || /\.\w{1,8}$/.test(value)
}

function fileFromTool(part: ToolPart) {
  const meta = "metadata" in part.state ? asRecord(part.state.metadata) : undefined
  const filediff = asRecord(meta?.filediff)
  const input = part.state.input
  const raw =
    (typeof filediff?.file === "string" && filediff.file) ||
    (typeof meta?.filepath === "string" && meta.filepath) ||
    (typeof meta?.file === "string" && meta.file) ||
    (input &&
      String(
        input.path ??
          input.file_path ??
          input.filePath ??
          input.target_file ??
          input.targetFile ??
          input.file ??
          "",
      )) ||
    ("title" in part.state && part.state.title && looksLikePath(String(part.state.title))
      ? String(part.state.title)
      : "")
  const path = raw.trim()
  if (!path) return null
  return { path, name: basename(path) }
}

function plural(n: number, one: string, many: string) {
  return n === 1 ? one : many
}

function capitalize(text: string) {
  if (!text) return text
  return text[0].toUpperCase() + text.slice(1)
}

function basename(path: string) {
  const trimmed = path.replace(/[\\/]+$/, "")
  const parts = trimmed.split(/[\\/]/)
  return parts[parts.length - 1] || trimmed
}

function truncate(text: string, max = 56) {
  const compact = text.replace(/\s+/g, " ").trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, max - 1)}…`
}

export function activityDiff(parts: Part[]): ActivityDiff | null {
  let added = 0
  let removed = 0
  for (const part of parts) {
    if (part.type !== "tool") continue
    const tool = part as ToolPart
    if (bucketOf(tool.tool) !== "edit") continue
    const next = diffFromTool(tool)
    added += next.added
    removed += next.removed
  }
  if (added === 0 && removed === 0) return null
  return { added, removed }
}

export function changedFiles(parts: Part[]): ChangedFile[] {
  const map = new Map<string, ChangedFile>()
  for (const part of parts) {
    if (part.type !== "tool") continue
    const tool = part as ToolPart
    if (bucketOf(tool.tool) !== "edit") continue
    const file = fileFromTool(tool)
    if (!file) continue
    const diff = diffFromTool(tool)
    const prev = map.get(file.path)
    if (prev) {
      prev.added += diff.added
      prev.removed += diff.removed
      if (diff.patch) prev.patch = prev.patch ? `${prev.patch}\n${diff.patch}` : diff.patch
    } else {
      map.set(file.path, { ...file, ...diff })
    }
  }
  return [...map.values()]
}

function countDiffLines(text: string): ActivityDiff {
  let added = 0
  let removed = 0
  for (const line of text.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@") || line.startsWith("diff ")) continue
    if (line.startsWith("+")) added += 1
    else if (line.startsWith("-")) removed += 1
  }
  return { added, removed }
}

function diffFromTool(part: ToolPart): ActivityDiff & { patch?: string } {
  const meta = "metadata" in part.state ? asRecord(part.state.metadata) : undefined
  const filediff = asRecord(meta?.filediff)
  const added = Number(filediff?.additions ?? meta?.additions ?? meta?.added ?? meta?.insertions ?? Number.NaN)
  const removed = Number(filediff?.deletions ?? meta?.deletions ?? meta?.removed ?? meta?.removals ?? Number.NaN)
  const patchRaw = filediff?.patch ?? meta?.diff
  const patch = typeof patchRaw === "string" && patchRaw.trim() ? patchRaw : undefined
  if (Number.isFinite(added) || Number.isFinite(removed)) {
    return {
      added: Number.isFinite(added) ? added : 0,
      removed: Number.isFinite(removed) ? removed : 0,
      patch,
    }
  }
  if (patch) return { ...countDiffLines(patch), patch }
  const output = part.state.status === "completed" ? part.state.output ?? "" : ""
  if (output.includes("\n+") || output.includes("\n-")) return { ...countDiffLines(output), patch: output }
  const name = part.tool.toLowerCase()
  if (name === "write" && part.state.status === "completed") {
    const content = String(part.state.input?.content ?? "")
    const lines = content ? content.split("\n").length : 0
    if (lines) return { added: lines, removed: 0 }
  }
  return { added: 0, removed: 0, patch }
}

export function activitySummary(parts: Part[]) {
  const tools = parts.filter((part): part is ToolPart => part.type === "tool")
  if (tools.length === 0) {
    if (parts.some((part) => part.type === "reasoning")) return thoughtLabel(parts)
    return ""
  }

  const files = {
    edit: new Set<string>(),
    explore: new Set<string>(),
  }
  const counts = { edit: 0, explore: 0, search: 0, browser: 0, command: 0, lint: 0 }

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
  if (edit) bits.push(plural(edit, "edited 1 file", `edited ${edit} files`))
  if (explore) bits.push(plural(explore, "explored 1 file", `explored ${explore} files`))
  if (counts.search) bits.push(plural(counts.search, "1 search", `${counts.search} searches`))
  if (counts.lint) bits.push(plural(counts.lint, "1 lint", `${counts.lint} lints`))
  if (counts.browser) bits.push(plural(counts.browser, "1 browser action", `${counts.browser} browser actions`))
  if (counts.command) bits.push(plural(counts.command, "ran 1 command", `ran ${counts.command} commands`))
  return capitalize(bits.join(", "))
}

export function activityStatus(parts: Part[]): string {
  const tools = parts.filter((part): part is ToolPart => part.type === "tool")
  const running = [...tools].reverse().find(
    (part) => part.state.status === "pending" || part.state.status === "running",
  )
  if (running) return liveStepLabel(running)

  let lastReasoning = -1
  let lastTool = -1
  parts.forEach((part, index) => {
    if (part.type === "reasoning") lastReasoning = index
    if (part.type === "tool") lastTool = index
  })
  if (lastReasoning > lastTool) return "Thought"
  return "Thinking"
}

function liveStepLabel(part: ToolPart) {
  const name = part.tool.toLowerCase()
  const input = part.state.input ?? {}
  const fileInfo = fileFromTool(part)
  const file = fileInfo?.name ?? ""
  const pattern = String(input.pattern ?? input.glob ?? "")
  const command = String(input.command ?? "")
  const query = String(input.query ?? "")
  const title = "title" in part.state ? part.state.title : undefined

  if (name === "read") return file ? `Read ${file}` : "Read"
  if (name === "glob") return pattern ? `Explored ${truncate(pattern, 40)}` : "Explored"
  if (name === "list" || name === "ls") return file ? `Explored ${file}` : "Explored"
  if (name === "grep") return pattern ? `Search ${truncate(pattern, 40)}` : "Search"
  if (name === "websearch") return query ? `Search ${truncate(query, 40)}` : "Search"
  if (name === "webfetch") return "Search"
  if (name === "edit" || name === "write" || name === "multiedit") {
    return file ? `Edited ${file}` : "Edited"
  }
  if (name === "bash" || name === "shell") return command ? `Ran ${truncate(command, 40)}` : "Ran"
  if (name.includes("lint")) return "Explored"
  if (title) return String(title)
  if (file) return `${capitalize(name)} ${file}`
  return capitalize(name)
}

function thoughtLabel(parts: Part[]) {
  const texts = parts.filter((part): part is ReasoningPart => part.type === "reasoning")
  const length = texts.reduce((sum, part) => sum + (part.text?.trim().length ?? 0), 0)
  return length > 0 && length < 160 ? "Thought briefly" : "Thought"
}

export function stepLabel(part: Part) {
  if (part.type === "reasoning") return thoughtLabel([part])
  if (part.type !== "tool") return ""
  const tool = part as ToolPart
  const name = tool.tool.toLowerCase()
  const input = tool.state.input ?? {}
  const path = String(input.path ?? input.file_path ?? input.filePath ?? input.target_file ?? input.targetFile ?? input.file ?? "")
  const pattern = String(input.pattern ?? input.glob ?? "")
  const command = String(input.command ?? "")
  const url = String(input.url ?? "")
  const query = String(input.query ?? "")
  const title = "title" in tool.state ? tool.state.title : undefined
  const file = path ? basename(path) : title ? basename(String(title)) : ""

  if (name === "read") {
    const offset = Number(input.offset ?? input.start_line ?? Number.NaN)
    const limit = Number(input.limit ?? Number.NaN)
    if (file && Number.isFinite(offset) && Number.isFinite(limit)) {
      return `Read ${file} L${offset}-${offset + limit}`
    }
    return file ? `Read ${file}` : "Read file"
  }
  if (name === "glob") return pattern ? `Searched files ${truncate(pattern, 64)}` : "Searched files"
  if (name === "grep") return pattern ? `Grepped ${truncate(pattern, 64)}` : "Grepped"
  if (name === "list" || name === "ls") return path ? `Listed ${truncate(path, 48)}` : "Listed directory"
  if (name === "edit") return file ? `Edited ${file}` : "Edited file"
  if (name === "write") return file ? `Wrote ${file}` : "Wrote file"
  if (name === "bash" || name === "shell") return command ? `Ran ${truncate(command)}` : "Ran command"
  if (name === "webfetch") return url ? `Fetched ${truncate(url)}` : "Fetched page"
  if (name === "websearch") return query ? `Searched ${truncate(query)}` : "Searched web"
  if (title) return String(title)
  return tool.tool
}

export function stepBody(part: Part) {
  if (part.type === "reasoning") return (part as ReasoningPart).text ?? ""
  if (part.type !== "tool") return ""
  const tool = part as ToolPart
  if (tool.state.status === "completed") return tool.state.output ?? ""
  if (tool.state.status === "error") return tool.state.error ?? ""
  return JSON.stringify(tool.state.input ?? {}, null, 2)
}

function toMs(value: number) {
  if (value > 1e12) return value
  if (value > 1e9) return value * 1000
  return value
}

export function workDurationMs(assistants: Message[], parts: Part[]) {
  const start: number[] = []
  const end: number[] = []
  for (const message of assistants) {
    if (message.role !== "assistant") continue
    const info = message as AssistantMessage
    if (info.time.created) start.push(toMs(info.time.created))
    if (info.time.completed) end.push(toMs(info.time.completed))
  }
  for (const part of parts) {
    if (part.type !== "tool") continue
    const time = "time" in part.state ? part.state.time : undefined
    if (time?.start) start.push(toMs(time.start))
    if (time && "end" in time && time.end) end.push(toMs(time.end))
  }
  if (!start.length) return 0
  const from = Math.min(...start)
  const to = end.length ? Math.max(...end) : from
  return Math.max(0, to - from)
}

export function formatWorkedFor(ms: number) {
  const seconds = Math.max(1, Math.round(ms / 1000) || 1)
  if (seconds < 60) return `Worked for ${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return rest ? `Worked for ${minutes}m ${rest}s` : `Worked for ${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remain = minutes % 60
  return remain ? `Worked for ${hours}h ${remain}m` : `Worked for ${hours}h`
}
