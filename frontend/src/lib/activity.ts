import { LONG_TERMINAL_MS, shellWaitLabel } from "./terminal-policy"
import type { AssistantMessage, Message, Part, ReasoningPart, ToolPart } from "./types"
import { basename } from "./path"

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

function asTool(part: Part): ToolPart | undefined {
  if (part.type !== "tool") return undefined
  return part as ToolPart
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
    const lines = content ? content.replace(/\n$/, "").split("\n").length : 0
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

function toolStartedAt(part: ToolPart) {
  const meta = "metadata" in part.state ? asRecord(part.state.metadata) : undefined
  const fromMeta = Number(meta?.terminalStartedAt)
  if (Number.isFinite(fromMeta)) return fromMeta
  const fromState = "time" in part.state ? Number(part.state.time?.start) : Number.NaN
  return Number.isFinite(fromState) ? fromState : Number.NaN
}

function waitLabelFor(part: ToolPart, now: number) {
  const meta = "metadata" in part.state ? asRecord(part.state.metadata) : undefined
  const started = toolStartedAt(part)
  const nextCheck = Number(meta?.nextCheckAt)
  if (Number.isFinite(nextCheck)) {
    if (Number.isFinite(started) && now - started < LONG_TERMINAL_MS) return ""
    return shellWaitLabel(nextCheck - now)
  }
  // Silent foreground shells often only declare input.timeout — surface that after the
  // short-command grace period so the UI does not freeze on "Planning next moves".
  const timeout = Number(part.state.input?.timeout)
  if (!Number.isFinite(timeout) || timeout <= 0 || !Number.isFinite(started)) return ""
  if (now - started < LONG_TERMINAL_MS) return ""
  return shellWaitLabel(started + timeout - now)
}

/** True when a live shell should advertise its remaining wait instead of vanishing into Planning. */
export function liveShellWaitLabel(part: ToolPart, now = Date.now()) {
  const name = part.tool.toLowerCase()
  if (!["bash", "shell", "shell_wait", "shell_status", "shell_cancel"].includes(name)) return ""
  if (part.state.status !== "pending" && part.state.status !== "running") return ""
  return waitLabelFor(part, now)
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

function looksLikeRawShell(text: string) {
  return /[|;&><]|&&|\|\||\$\(|`/.test(text) || /\s-\S/.test(text) || text.includes("/") || text.includes("\\")
}

/** Human label for a long-running shell — never dump argv the way Cursor Glass avoids. */
export function terminalDisplayTitle(command: string, description?: string) {
  const hint = description?.trim()
  if (hint && hint !== command.trim() && !looksLikeRawShell(hint)) return truncate(hint, 72)

  const compact = command.replace(/\s+/g, " ").trim()
  if (!compact) return "Terminal task"

  // Prefer intent labels before argv parsing — flags like `+x` are not human titles.
  if (/\b(pkill|killall|kill)\b/.test(compact)) return "Stop background process"
  if (/\bxcodebuild\b/i.test(compact)) return "Xcode build"
  if (/\b(downloadComponent|metal)\b/i.test(compact)) return "Download build components"
  if (/\bchmod\b/.test(compact) && /\.sh\b/.test(compact)) return "Prepare script"
  if (/\b(tauri|vite)\b/i.test(compact) && /\bdev\b/i.test(compact)) return "Launch app in dev mode"
  if (/\b(npm|pnpm|yarn|bunx?)\b/.test(compact) && /\b(dev|start|serve)\b/.test(compact)) return "Start dev server"
  if (/\b(npm|pnpm|yarn|bunx?)\b/.test(compact) && /\b(test|vitest|jest)\b/.test(compact)) return "Run tests"
  if (/\b(npm|pnpm|yarn|bunx?)\b/.test(compact) && /\b(build|pack)\b/.test(compact)) return "Build project"
  if (/\b(grep|rg|tr)\b/.test(compact)) return "Inspect output"
  if (/\b(tail|less|cat)\b/.test(compact) && /\.log\b/.test(compact)) return "Watch logs"
  if (/\b(curl|wget)\b/.test(compact)) return "Download file"
  if (/\bsleep\b/.test(compact)) return "Wait"

  const action = commandAction(compact)
  if (
    action &&
    !looksLikeRawShell(action) &&
    !/^[-+]/.test(action) &&
    action !== truncate(compact) &&
    action !== truncate(compact, 42)
  ) {
    return truncate(capitalize(action), 72)
  }

  const stripped = compact.replace(/^(?:[A-Z_][A-Z0-9_]*=\S+\s+)+/, "")
  const bin = basename(stripped.split(" ")[0] ?? "")
  if (bin && !looksLikePath(bin) && !["sh", "bash", "zsh", "cmd", "powershell"].includes(bin.toLowerCase())) {
    return truncate(humanizePhrase(bin), 72)
  }
  return "Terminal task"
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
  return "Planning next moves"
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
  if (["bash", "shell", "shell_wait", "shell_status", "shell_cancel"].includes(name)) {
    const waiting = waitLabelFor(part, now)
    if (waiting) return waiting
    const title = terminalDisplayTitle(command, headline)
    const action = title !== "Terminal task" ? title : headline || commandAction(command)
    return withDetail("Running", action)
  }
  if (name === "task" || name === "subagent") {
    const desc = headline || String(input.description ?? "")
    return withDetail("Working on task", desc)
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

function thoughtHeadline(parts: Part[]) {
  const text = parts.find((part) => part.type === "reasoning" && part.text.trim())
  const value = text && text.type === "reasoning" ? text.text : ""
  const bold = value.match(/^\s*\*\*([^*\n]+)\*\*/)
  if (bold?.[1]?.trim()) return bold[1].trim()
  const heading = value.match(/^\s*#{1,6}\s+(\S.*)/)
  if (heading?.[1]?.trim()) return heading[1].trim()
  return "Thought"
}

function formatThoughtDetail(ms: number) {
  return ms < 500 ? "briefly" : formatDuration(ms)
}

function thoughtLabel(parts: Part[]) {
  const duration = reasoningDurationMs(parts)
  const headline = thoughtHeadline(parts)
  return duration !== null ? `${headline} ${formatThoughtDetail(duration)}` : headline
}

export type StepPresentation = {
  action: string
  detail?: string
  context?: string
}

export function stepPresentation(part: Part, opts: { live?: boolean } = {}): StepPresentation {
  if (part.type === "reasoning") {
    if (opts.live || !Number.isFinite((part as ReasoningPart).time?.end)) {
      return { action: "Thinking" }
    }
    const duration = reasoningDurationMs([part])
    return { action: thoughtHeadline([part]), detail: duration !== null ? formatThoughtDetail(duration) : undefined }
  }
  if (part.type !== "tool") return { action: "" }
  const tool = part as ToolPart
  const live = opts.live === true
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
    const action = live ? "Reading" : "Read"
    if (file && Number.isFinite(shownStart) && shownStart >= 1 && Number.isFinite(shownEnd) && shownEnd >= shownStart) {
      return { action, detail: `${file} L${shownStart}-${shownEnd}` }
    }
    const offset = Number(input.offset ?? input.start_line ?? Number.NaN)
    const limit = Number(input.limit ?? Number.NaN)
    if (file && Number.isFinite(offset) && offset >= 1 && Number.isFinite(limit) && limit >= 1) {
      return { action, detail: `${file} L${offset}-${offset + limit - 1}` }
    }
    return { action, detail: file || "file" }
  }
  if (name === "glob") {
    return { action: live ? "Searching files" : "Searched files", detail: pattern ? truncate(pattern, 64) : undefined, context: suffix }
  }
  if (name === "grep") {
    return { action: live ? "Grepping" : "Grepped", detail: pattern ? truncate(pattern, 64) : undefined, context: suffix }
  }
  if (name === "list" || name === "ls") return { action: live ? "Listing" : "Listed", detail: stepLocation(path) || "directory" }
  if (name === "edit" || name === "multiedit") return { action: live ? "Editing" : "Edited", detail: file || "file" }
  if (name === "write") return { action: live ? "Writing" : "Wrote", detail: file || "file" }
  if (name === "apply_patch" || name === "applypatch") {
    return file
      ? { action: live ? "Patching" : "Patched", detail: file }
      : { action: live ? "Applying patch" : "Applied patch" }
  }
  if (["bash", "shell", "shell_wait", "shell_status", "shell_cancel"].includes(name)) {
    const titled = title && String(title).trim() !== command.trim() ? String(title).trim() : ""
    const described = String(input.description ?? input.title ?? "").trim()
    const detail = terminalDisplayTitle(command, described || titled)
    return { action: live ? "Running" : "Ran", detail }
  }
  if (name === "webfetch") return { action: live ? "Fetching" : "Fetched", detail: url ? hostFromUrl(url) : "page" }
  if (name === "websearch") return { action: live ? "Searching" : "Searched", detail: query ? truncate(query) : "web" }
  if (name === "question") {
    const questions = Array.isArray(input.questions) ? input.questions : []
    const first = asRecord(questions[0])
    const detail = String(first?.header ?? first?.question ?? "").trim()
    return { action: live ? "Asking" : "Asked", detail: detail ? truncate(detail, 64) : "a question" }
  }
  if (name === "todowrite" || name === "todo") return { action: live ? "Checking" : "Checked", detail: "to-do list" }
  if (name === "task" || name === "subagent") {
    const desc = String(input.description ?? title ?? "").trim()
    return { action: live ? "Working on task" : "Completed task", detail: desc ? truncate(desc, 64) : undefined }
  }
  if (title) return { action: capitalize(tool.tool), detail: String(title) }
  return { action: capitalize(tool.tool) }
}

function stepLocation(value: unknown) {
  const raw = String(value ?? "").trim().replace(/[\\/]+$/, "")
  if (!raw) return ""
  return truncate(looksLikePath(raw) ? basename(raw) || raw : raw, 48)
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
