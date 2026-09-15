import type { AssistantMessage, Message, Part, ReasoningPart, ToolPart } from "./types"
import { basename } from "./path"

export type ActivityBlock =
  | { kind: "work"; key: string; parts: Part[] }
  | { kind: "answer"; key: string; parts: Part[] }

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
    else blocks.push({ kind, key: `${kind}:${part.id}`, parts: [part] })
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

function asTool(part: Part): ToolPart | undefined {
  if (part.type !== "tool") return undefined
  return part as ToolPart
}

export function isWorkLive(parts: Part[]) {
  return parts.some((part) => {
    const tool = asTool(part)
    return tool?.state.status === "pending" || tool?.state.status === "running"
  })
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

type Bucket = "edit" | "explore" | "search" | "browser" | "command" | "lint" | "question" | "todo"

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
  if (name === "read") return "explore"
  if (name === "glob" || name === "grep" || name === "list" || name === "ls") return "search"
  if (name === "question") return "question"
  if (name === "todowrite" || name === "todo") return "todo"
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

export function activityFailureCount(parts: Part[]) {
  return parts.filter((part) => part.type === "tool" && part.state.status === "error").length
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
  const counts = { edit: 0, explore: 0, search: 0, browser: 0, command: 0, lint: 0, question: 0, todo: 0 }

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
  if (counts.question) bits.push(plural(counts.question, "asked 1 question", `asked ${counts.question} questions`))
  if (!bits.length && counts.todo) bits.push("checked to-do list")
  return capitalize(bits.join(", "))
}

const WAIT_AFTER_MS = 2000

function waitSeconds(value: unknown) {
  const ms = Number(value)
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return Math.max(1, Math.round(ms / 1000))
}

function waitLabelFor(part: ToolPart, now: number, action = "") {
  const seconds = waitSeconds(part.state.input?.timeout)
  if (!seconds) return ""
  const time = "time" in part.state ? part.state.time : undefined
  const start = time?.start ? toMs(time.start) : Number.NaN
  if (!Number.isFinite(start) || now - start < WAIT_AFTER_MS) return ""
  return action ? `Waiting up to ${seconds}s · ${action}` : `Waiting up to ${seconds}s for ${part.tool.toLowerCase()}`
}

function withDetail(verb: string, detail: string) {
  return detail ? `${verb} ${detail}` : verb
}

function humanizePhrase(raw: string) {
  const text = raw
    .replace(/\.(?:js|ts|mjs|cjs|jsx|tsx|sh|py|rb|php)$/i, "")
    .replace(/[-_./]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
  if (!text) return raw.trim()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function knownCommandAction(bin: string, arg: string) {
  const name = `${bin} ${arg}`.toLowerCase()
  if (/\b(test|tests|spec|vitest|jest|pytest|mocha)\b/.test(name)) return "tests"
  if (/\b(lint|eslint|prettier|fmt|format)\b/.test(name)) return "lint"
  if (/\b(build|compile|tsc)\b/.test(name)) return "build"
  if (/\b(install|ci)\b/.test(name)) return "install"
  if (/\b(dev|serve|start)\b/.test(name)) return "dev server"
  return ""
}

function commandAction(command: string) {
  const compact = command.replace(/\s+/g, " ").trim()
  if (!compact) return ""
  const stripped = compact.replace(/^(?:[A-Z_][A-Z0-9_]*=\S+\s+)+/, "")
  const pkg = stripped.match(/^(npm|pnpm|yarn|bunx?)\s+(?:run\s+)?(\S+)/)
  if (pkg) {
    const script = pkg[2]
    if (script.startsWith("-")) return truncate(stripped, 42)
    return knownCommandAction(pkg[1], script) || humanizePhrase(script)
  }
  const make = stripped.match(/^make\s+(\S+)/)
  if (make) return humanizePhrase(make[1])
  const cargo = stripped.match(/^cargo\s+(\S+)/)
  if (cargo) return knownCommandAction("cargo", cargo[1]) || humanizePhrase(cargo[1])
  const go = stripped.match(/^go\s+(\S+)/)
  if (go) return knownCommandAction("go", go[1]) || humanizePhrase(go[1])
  const tokens = stripped.split(" ")
  const bin = basename(tokens[0] ?? "")
  const arg = tokens.find((token, index) => index > 0 && !token.startsWith("-")) ?? ""
  return knownCommandAction(bin, arg) || (arg && !looksLikePath(arg) ? humanizePhrase(arg) : truncate(stripped, 42))
}

function toolHeadline(part: ToolPart) {
  const title = "title" in part.state && part.state.title ? String(part.state.title).trim() : ""
  const meta = "metadata" in part.state ? asRecord(part.state.metadata) : undefined
  const fromMeta = String(meta?.title ?? meta?.description ?? "").trim()
  const raw = title || fromMeta
  if (!raw) return ""
  const lower = raw.toLowerCase()
  if (["bash", "shell", "run", "command", "running", "tool"].includes(lower)) return ""
  if (/^(npm|pnpm|yarn|bunx?|cargo|go|python|node|bash|sh|zsh)\s/.test(lower)) return commandAction(raw)
  return raw
}

function hostFromUrl(value: string) {
  try {
    return new URL(value).hostname || truncate(value, 40)
  } catch {
    return truncate(value, 40)
  }
}

export function activityStatus(parts: Part[], now = Date.now()): string {
  const tools = parts.filter((part): part is ToolPart => part.type === "tool")
  const running = [...tools].reverse().find(
    (part) => part.state.status === "pending" || part.state.status === "running",
  )
  if (running) return liveStepLabel(running, now)

  let lastReasoning: ReasoningPart | undefined
  let lastReasoningIndex = -1
  let lastTool = -1
  parts.forEach((part, index) => {
    if (part.type === "reasoning") {
      lastReasoning = part
      lastReasoningIndex = index
    }
    if (part.type === "tool") lastTool = index
  })
  if (lastReasoningIndex > lastTool) return lastReasoning?.time?.end ? "Thought" : "Thinking"
  if (lastTool >= 0) return "Planning next moves"
  return "Thinking"
}

function liveStepLabel(part: ToolPart, now: number) {
  const name = part.tool.toLowerCase()
  const input = part.state.input ?? {}
  const fileInfo = fileFromTool(part)
  const file = fileInfo?.name ?? ""
  const path = String(input.path ?? input.target_directory ?? input.directory ?? "")
  const folder = path ? basename(path) : ""
  const pattern = String(input.pattern ?? input.glob ?? "")
  const command = String(input.command ?? "")
  const query = String(input.query ?? "")
  const url = String(input.url ?? "")
  const headline = toolHeadline(part)

  if (name === "read") return withDetail("Reading", file)
  if (name === "glob") return withDetail("Exploring", pattern ? truncate(pattern, 40) : folder)
  if (name === "list" || name === "ls") return withDetail("Exploring", file || folder)
  if (name === "grep") return withDetail("Searching", pattern ? truncate(pattern, 40) : "")
  if (name === "websearch") return withDetail("Searching", query ? truncate(query, 40) : "the web")
  if (name === "webfetch") return withDetail("Fetching", url ? hostFromUrl(url) : "")
  if (name === "edit" || name === "write" || name === "multiedit" || name === "apply_patch" || name === "applypatch") {
    return withDetail("Editing", file)
  }
  if (name === "bash" || name === "shell") {
    const action = headline || commandAction(command)
    const waiting = waitLabelFor(part, now, action)
    if (waiting) return waiting
    return withDetail("Running", action)
  }
  if (name === "task") {
    const desc = headline || String(input.description ?? "")
    return withDetail("Running", desc)
  }
  if (name === "skill") return withDetail("Loading", headline || String(input.name ?? input.skill ?? ""))
  if (name === "question") return "Asking questions"
  if (name.includes("lint")) return withDetail("Linting", file)
  if (headline) return headline
  if (file) return `${capitalize(name)} ${file}`
  return capitalize(name)
}

export function reasoningDurationMs(parts: Part[]) {
  let found = false
  const duration = parts.reduce((total, part) => {
    if (part.type !== "reasoning" || !part.time) return total
    const start = Number(part.time.start)
    const end = Number(part.time.end)
    if (!Number.isFinite(start) || !Number.isFinite(end)) return total
    found = true
    return total + Math.max(0, toMs(end) - toMs(start))
  }, 0)
  return found ? duration : null
}

function thoughtLabel(parts: Part[]) {
  const duration = reasoningDurationMs(parts)
  return duration !== null ? `Thought ${formatDuration(duration)}` : "Thought"
}

export type StepPresentation = {
  action: string
  detail?: string
  context?: string
}

export function stepPresentation(part: Part): StepPresentation {
  if (part.type === "reasoning") {
    const duration = reasoningDurationMs([part])
    return { action: "Thought", detail: duration !== null ? formatDuration(duration) : undefined }
  }
  if (part.type !== "tool") return { action: "" }
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
  const location = stepLocation(input.path ?? input.target_directory ?? input.directory)
  const suffix = location ? `in ${location}` : undefined

  if (name === "read") {
    const metadata = "metadata" in tool.state ? asRecord(tool.state.metadata) : undefined
    const display = asRecord(metadata?.display)
    const shownStart = Number(display?.lineStart)
    const shownEnd = Number(display?.lineEnd)
    if (file && Number.isFinite(shownStart) && shownStart >= 1 && Number.isFinite(shownEnd) && shownEnd >= shownStart) {
      return { action: "Read", detail: `${file} L${shownStart}-${shownEnd}` }
    }
    const offset = Number(input.offset ?? input.start_line ?? Number.NaN)
    const limit = Number(input.limit ?? Number.NaN)
    if (file && Number.isFinite(offset) && offset >= 1 && Number.isFinite(limit) && limit >= 1) {
      return { action: "Read", detail: `${file} L${offset}-${offset + limit - 1}` }
    }
    return { action: "Read", detail: file || "file" }
  }
  if (name === "glob") {
    return { action: "Searched files", detail: pattern ? truncate(pattern, 64) : undefined, context: suffix }
  }
  if (name === "grep") {
    return { action: "Grepped", detail: pattern ? truncate(pattern, 64) : undefined, context: suffix }
  }
  if (name === "list" || name === "ls") return { action: "Listed", detail: stepLocation(path) || "directory" }
  if (name === "edit" || name === "multiedit") return { action: "Edited", detail: file || "file" }
  if (name === "write") return { action: "Wrote", detail: file || "file" }
  if (name === "apply_patch" || name === "applypatch") {
    return file ? { action: "Patched", detail: file } : { action: "Applied patch" }
  }
  if (name === "bash" || name === "shell") {
    const titled = title && String(title).trim() !== command.trim() ? String(title).trim() : ""
    const described = String(input.description ?? input.title ?? "").trim()
    const action = described || titled || commandAction(command)
    if (action && action !== truncate(command) && action !== truncate(command, 42)) return { action: "Ran", detail: action }
    return { action: "Ran", detail: command ? truncate(command) : "command" }
  }
  if (name === "webfetch") return { action: "Fetched", detail: url ? hostFromUrl(url) : "page" }
  if (name === "websearch") return { action: "Searched", detail: query ? truncate(query) : "web" }
  if (name === "question") {
    const questions = Array.isArray(input.questions) ? input.questions : []
    const first = asRecord(questions[0])
    const detail = String(first?.header ?? first?.question ?? "").trim()
    return { action: "Asked", detail: detail ? truncate(detail, 64) : "a question" }
  }
  if (name === "todowrite" || name === "todo") return { action: "Checked", detail: "to-do list" }
  if (title) return { action: capitalize(tool.tool), detail: String(title) }
  return { action: capitalize(tool.tool) }
}

function stepLocation(value: unknown) {
  const raw = String(value ?? "").trim().replace(/[\\/]+$/, "")
  if (!raw) return ""
  return truncate(looksLikePath(raw) ? basename(raw) || raw : raw, 48)
}

export function stepLabel(part: Part) {
  const value = stepPresentation(part)
  return [value.action, value.detail, value.context].filter(Boolean).join(" ")
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
    const tool = asTool(part)
    if (!tool || !("time" in tool.state) || !tool.state.time) continue
    const time = tool.state.time
    const started = Number(time.start)
    const ended = "end" in time ? Number(time.end) : Number.NaN
    if (Number.isFinite(started)) start.push(toMs(started))
    if (Number.isFinite(ended)) end.push(toMs(ended))
  }
  if (!start.length) return 0
  const from = Math.min(...start)
  const to = end.length ? Math.max(...end) : from
  return Math.max(0, to - from)
}

export function formatWorkedFor(ms: number) {
  return `Worked for ${formatDuration(ms)}`
}

export function formatDuration(ms: number) {
  const seconds = Math.max(1, Math.round(ms / 1000) || 1)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remain = minutes % 60
  return remain ? `${hours}h ${remain}m` : `${hours}h`
}
