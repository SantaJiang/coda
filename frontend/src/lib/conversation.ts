import { basename } from "./path"
import { activityFailureCount, activityStatus, formatDuration, workDurationMs } from "./activity"
import { formatSessionErrorMessage, isAbortError } from "./session-status"
import type { AssistantMessage, Message, Part, SessionStatus, ToolPart, UserMessage } from "./types"

export type TurnPhase = "sending" | "waiting" | "running" | "permission" | "question" | "retry" | "stopping" | "settling" | "done" | "failed" | "stopped" | "interrupted"
export type CompactionEntry = { kind: "compaction"; key: string; status: "running" | "done" | "failed" | "interrupted"; summary: string; error?: string }
export type ConversationEntry = { kind: "part"; key: string; part: Part } | CompactionEntry
export type ConversationBlock = { kind: "work" | "content" | "system"; key: string; entries: ConversationEntry[] }

/** Narration separates activity groups; completed steps stay in their original group. */
export function conversationBlocks(entries: ConversationEntry[]): ConversationBlock[] {
  const blocks: ConversationBlock[] = []
  for (const entry of entries) {
    const kind = entry.kind === "compaction" ? "system" : entry.part.type === "tool" || entry.part.type === "reasoning" ? "work" : "content"
    const previous = blocks[blocks.length - 1]
    if (previous && previous.kind === kind && kind !== "system") previous.entries.push(entry)
    else blocks.push({ kind, key: `${kind}:${entry.key}`, entries: [entry] })
  }
  return blocks
}
export type ConversationTurn = {
  id: string
  user?: UserMessage
  assistants: AssistantMessage[]
  entries: ConversationEntry[]
  process: ConversationEntry[]
  answer: ConversationEntry[]
  phase: TurnPhase
  active: boolean
  label: string
  error?: string
  summary: string
  durationMs: number
  failures: number
}
export type ConversationContext = {
  status?: SessionStatus
  sending?: boolean
  stopping?: boolean
  settling?: boolean
  stoppedTurnID?: string
  stoppedTurns?: Record<string, boolean>
  permissionCount?: number
  questionCount?: number
  sessionError?: string
  now?: number
}

export function visibleConversationPart(part: Part) {
  if (part.type === "text") return !part.synthetic && !part.ignored
  return ["tool", "reasoning", "file", "agent"].includes(part.type)
}

export function runningTool(part: Part): part is ToolPart {
  return part.type === "tool" && (part.state.status === "pending" || part.state.status === "running")
}

export function toolActivity(part: ToolPart) {
  const input = part.state.input ?? {}
  const path = String(input.filePath ?? input.file_path ?? input.path ?? "")
  const file = path ? ` ${basename(path)}` : ""
  const name = part.tool.toLowerCase()
  if (name === "read") return `读取文件${file}`
  if (["edit", "write", "multiedit", "apply_patch", "applypatch"].includes(name)) return `修改文件${file}`
  if (["glob", "grep", "list", "ls"].includes(name)) return "搜索项目"
  if (["bash", "shell", "shell_wait", "shell_status", "shell_cancel"].includes(name)) return "执行命令"
  if (name === "websearch") return "搜索网页"
  if (name === "webfetch") return "读取网页"
  if (name === "question") return "处理提问"
  if (["todowrite", "todo"].includes(name)) return "更新任务列表"
  if (name === "skill") return "加载技能"
  return `执行 ${part.tool}`
}

function statusLabel(phase: TurnPhase, entries: ConversationEntry[], ctx: ConversationContext) {
  const labels: Partial<Record<TurnPhase, string>> = {
    sending: "Planning next moves", waiting: "Planning next moves", permission: "Waiting for permission", question: "Asking questions",
    stopping: "Stopping", settling: "Syncing response", done: "已完成", failed: "回复失败", stopped: "已停止", interrupted: "回复已中断",
  }
  if (phase === "retry") {
    const retry = ctx.status?.type === "retry" ? ctx.status : undefined
    const seconds = retry?.next ? Math.max(0, Math.ceil((retry.next - (ctx.now ?? Date.now())) / 1000)) : 0
    return `Retrying${seconds ? ` in ${seconds}s` : ""}${retry?.attempt ? ` · attempt ${retry.attempt}` : ""}`
  }
  if (labels[phase]) return labels[phase]!
  const running = entries.flatMap((entry) => entry.kind === "part" && runningTool(entry.part) ? [entry.part] : [])
  if (running.length) return `${activityStatus(running, ctx.now)}${running.length > 1 ? ` · ${running.length} 项运行中` : ""}`
  const last = entries[entries.length - 1]
  if (last?.kind === "compaction" && last.status === "running") return "Compacting context"
  if (last?.kind === "part" && last.part.type === "text") return "Writing response"
  const parts = entries.flatMap((entry) => entry.kind === "part" ? [entry.part] : [])
  const activity = activityStatus(parts, ctx.now)
  return activity === "Thought" ? "Planning next moves" : activity
}

function successfulEnd(message?: AssistantMessage) {
  return !!message && Boolean(message.time.completed) && !message.error && (!message.finish || !["tool-calls", "unknown", "error", "length", "content-filter"].includes(message.finish))
}

/** One projection for live events, snapshots and history. Components never infer completion. */
export function conversationTurns(messages: Message[], partsByMessage: Record<string, Part[]>, ctx: ConversationContext = {}): ConversationTurn[] {
  type RawTurn = { id: string; user?: UserMessage; assistants: AssistantMessage[]; events: Array<{ created: number; id: string; entries: ConversationEntry[] }> }
  const turns: RawTurn[] = []
  const byUser = new Map<string, RawTurn>()
  const compactions = new Map<string, { owner: RawTurn; entry: CompactionEntry }>()
  let current: RawTurn | undefined
  const ordered = [...messages].sort((a, b) => a.time.created - b.time.created || a.id.localeCompare(b.id))
  // Index all user parents before attaching late assistant updates.
  for (const message of ordered) {
    if (message.role !== "user") continue
    const parts = partsByMessage[message.id] ?? []
    if (parts.some((part) => part.type === "compaction")) {
      if (!current) {
        current = { id: `system:${message.id}`, assistants: [], events: [] }
        turns.push(current)
      }
      const entry: CompactionEntry = { kind: "compaction", key: `compaction:${message.id}`, status: "running", summary: "" }
      current.events.push({ created: message.time.created, id: message.id, entries: [entry] })
      compactions.set(message.id, { owner: current, entry })
    } else if (!parts.length || parts.some(visibleConversationPart)) {
      current = { id: message.id, user: message, assistants: [], events: [] }
      turns.push(current)
      byUser.set(message.id, current)
    }
  }
  for (const message of ordered) {
    if (message.role !== "assistant") continue
    const parts = partsByMessage[message.id] ?? []
    const compact = message.parentID ? compactions.get(message.parentID) : undefined
    if (compact || message.summary || message.agent === "compaction" || message.mode === "compaction") {
      const entry = compact?.entry ?? { kind: "compaction" as const, key: `compaction:${message.id}`, status: "running" as const, summary: "" }
      entry.status = isAbortError(message.error) ? "interrupted" : message.error ? "failed" : message.time.completed ? "done" : "running"
      entry.summary = parts.filter((part) => part.type === "text").map((part) => part.text).join("\n\n")
      entry.error = formatSessionErrorMessage(message.error?.data?.message) || undefined
      if (!compact) {
        const owner = message.parentID ? byUser.get(message.parentID) : turns.filter((turn) => !turn.user || turn.user.time.created <= message.time.created).slice(-1)[0]
        if (owner) owner.events.push({ created: message.time.created, id: message.id, entries: [entry] })
        else turns.push({ id: `system:${message.id}`, assistants: [], events: [{ created: message.time.created, id: message.id, entries: [entry] }] })
      }
      continue
    }
    let owner = message.parentID ? byUser.get(message.parentID) : undefined
    if (!owner && !message.parentID) owner = turns.filter((turn) => !turn.user || turn.user.time.created <= message.time.created).slice(-1)[0]
    if (!owner) {
      // An unavailable parent must not attach to another user's current turn.
      const id = `orphan:${message.parentID ?? message.id}`
      owner = turns.find((turn) => turn.id === id)
      if (!owner) { owner = { id, assistants: [], events: [] }; turns.push(owner) }
    }
    owner.assistants.push(message)
    owner.events.push({ created: message.time.created, id: message.id, entries: parts.filter(visibleConversationPart).map((part) => ({ kind: "part", key: `${message.id}:${part.id}`, part })) })
  }
  turns.sort((a, b) => (a.user?.time.created ?? a.events[0]?.created ?? 0) - (b.user?.time.created ?? b.events[0]?.created ?? 0))
  const latestUserID = [...ordered].reverse().find((message) => message.role === "user" && byUser.has(message.id))?.id
  return turns.map((turn) => {
    const tail = turn.id === (latestUserID ?? turns[turns.length - 1]?.id)
    turn.events.sort((a, b) => a.created - b.created || a.id.localeCompare(b.id))
    const entries = turn.events.flatMap((event) => event.entries)
    const parts = entries.flatMap((entry) => entry.kind === "part" ? [entry.part] : [])
    const last = turn.assistants[turn.assistants.length - 1]
    const stopped = isAbortError(last?.error) || ctx.stoppedTurnID === turn.id || Boolean(ctx.stoppedTurns?.[turn.id])
    const finalEntry = entries[entries.length - 1]
    const compactFailure = finalEntry?.kind === "compaction" && finalEntry.status === "failed" ? finalEntry : undefined
    const finishError = last?.finish === "length" ? "回复达到模型输出上限，内容未完整生成" : last?.finish === "content-filter" ? "模型供应商阻止了本次回复" : last?.finish === "error" ? "本轮回复失败" : ""
    const error = (!stopped ? formatSessionErrorMessage(last?.error?.data?.message) || (last?.error ? "本轮回复失败" : "") : "") || compactFailure?.error || (tail ? ctx.sessionError : undefined) || (!tail || ctx.status?.type === "idle" ? finishError : "")
    const unresolved = parts.some(runningTool) || entries.some((entry) => entry.kind === "compaction" && entry.status === "running")
    let phase: TurnPhase
    if (turn.user?.delivery === "sending") phase = "sending"
    else if (turn.user?.delivery === "failed" || turn.user?.delivery === "uncertain") phase = "failed"
    else if (error || (last?.error && !stopped) || (tail && ctx.status?.type === "idle" && ["error", "length", "content-filter"].includes(last?.finish ?? ""))) phase = "failed"
    else if (tail && ctx.stopping) phase = "stopping"
    else if (stopped) phase = "stopped"
    else if (tail && ctx.permissionCount) phase = "permission"
    else if (tail && ctx.questionCount) phase = "question"
    else if (tail && ctx.status?.type === "retry") phase = "retry"
    else if (tail && (ctx.status?.type === "busy" || ctx.sending)) phase = entries.length ? "running" : "waiting"
    else if (tail && (ctx.settling || !ctx.status)) phase = "settling"
    else if (successfulEnd(last) && !unresolved) phase = "done"
    else if (!turn.user && !turn.assistants.length && entries.every((entry) => entry.kind === "compaction" && entry.status === "done")) phase = "done"
    else phase = "interrupted"
    if (["done", "failed", "stopped", "interrupted"].includes(phase)) {
      for (const entry of entries) if (entry.kind === "compaction" && entry.status === "running") entry.status = "interrupted"
    }
    const active = !["done", "failed", "stopped", "interrupted"].includes(phase)
    let answer: ConversationEntry[] = []
    let process = entries
    const proseOnly = entries.every((entry) => entry.kind === "part" && ["text", "file", "agent"].includes(entry.part.type))
    if (phase === "done") {
      if (proseOnly) { answer = entries; process = [] }
      else {
        let cut = entries.length
        while (cut > 0) {
          const entry = entries[cut - 1]
          if (entry.kind !== "part" || entry.part.messageID !== last?.id || !["text", "file", "agent"].includes(entry.part.type)) break
          cut--
        }
        answer = entries.slice(cut)
        process = entries.slice(0, cut)
      }
      answer = answer.filter((entry) => entry.kind === "part" && (entry.part.type !== "text" || Boolean(entry.part.text.trim())))
    }
    const failures = activityFailureCount(parts)
    const tools = parts.filter((part) => part.type === "tool").length
    const durationMs = workDurationMs(turn.assistants, parts)
    const summary = [`已完成 · ${formatDuration(durationMs)}`, tools ? `${tools} 项操作` : "", failures ? `${failures} 项失败` : ""].filter(Boolean).join(" · ")
    return { ...turn, entries, process, answer, phase, active, label: statusLabel(phase, entries, ctx), error, summary, durationMs, failures }
  })
}

export type TimelineViewState = { top?: number; following: boolean; processOpen: Record<string, boolean>; groupOpen: Record<string, boolean>; stepOpen: Record<string, boolean> }
export function emptyTimelineView(): TimelineViewState { return { following: true, processOpen: {}, groupOpen: {}, stepOpen: {} } }
