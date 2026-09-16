import { For, Index, Match, Show, Switch, type JSX, createEffect, createMemo, createSignal } from "solid-js"
import {
  changedFiles,
  formatDuration,
  groupActivityBlocks,
  isWorkLive,
  splitProcessAndAnswer,
  workDurationMs,
  type ActivityBlock,
} from "../lib/activity"
import type {
  AgentPart,
  AssistantMessage,
  FilePart,
  Message,
  Part,
  ReasoningPart,
  RetryPart,
  TextPart,
  UserMessage,
} from "../lib/types"
import { useModels, useProjects, useRuntime } from "../store/app"
import { formatSessionErrorMessage, isAbortError } from "../lib/session-status"
import { MarkdownView } from "./MarkdownView"
import { WorkGroup } from "./WorkGroup"
import { ChangedFiles } from "./ChangedFiles"
import { Icon } from "./Icon"

const HIDDEN = new Set(["step-start", "step-finish", "patch", "snapshot", "compaction"])

export type ChatTurn = {
  user?: Message
  assistants: Message[]
}

export type TimelineItem =
  | ({ kind: "turn" } & ChatTurn)
  | { kind: "compaction"; id: string; status: "running" | "done" | "error"; summary?: string; error?: string }

export function compactionLabel(status: Extract<TimelineItem, { kind: "compaction" }>["status"]) {
  if (status === "error") return "Context compaction failed"
  if (status === "running") return "Context compaction interrupted"
  return "Context compacted"
}

export function isInterruptedTurn(live: boolean, busy: boolean, message?: AssistantMessage) {
  if (live || busy || !message) return false
  return !message.time.completed && !message.error
}

function partsOf(messageID: string, partsByMessage: Record<string, Part[]>) {
  return partsByMessage[messageID] ?? []
}

function isCompactionUser(message: Message, partsByMessage: Record<string, Part[]>) {
  return partsOf(message.id, partsByMessage).some((part) => part.type === "compaction")
}

function isSystemUser(message: Message, partsByMessage: Record<string, Part[]>) {
  if (message.role !== "user") return false
  const parts = partsOf(message.id, partsByMessage)
  if (!parts.length) return false
  return !parts.some(isVisiblePart)
}

function isCompactionAssistant(message: Message) {
  if (message.role !== "assistant") return false
  const info = message as AssistantMessage
  return info.summary === true || info.agent === "compaction" || info.mode === "compaction"
}

function assistantSettled(message: Message) {
  if (message.role !== "assistant") return false
  const info = message as AssistantMessage
  return Boolean(info.time.completed) || Boolean(info.error)
}

function isStreamingTurn(turn: ChatTurn) {
  return turn.assistants.length === 0 || turn.assistants.some((message) => !assistantSettled(message))
}

function isStreamingItem(item: TimelineItem) {
  if (item.kind === "compaction") return item.status === "running"
  return isStreamingTurn(item)
}

export function timelineItemKey(item: TimelineItem, index: number) {
  if (item.kind === "compaction") return `compaction:${item.id || index}`
  return `turn:${item.user?.id ?? item.assistants[0]?.id ?? index}`
}

export function nextLiveItemKey(latched: string, busy: boolean, items: TimelineItem[]) {
  const index = items.length - 1
  const item = index >= 0 ? items[index] : undefined
  if (!busy || !item) return ""
  const key = timelineItemKey(item, index)
  // 已完成的 compaction 不应靠闩锁保持 live（否则 done 的总结会继续转圈）。
  // turn 需要在 step 间隙保持 live（中间 assistant 先 settle，下一步还没创建），
  // compaction 是单条总结，完成后就应回到 settled 展示。
  if (key === latched) {
    if (item.kind === "compaction") return isStreamingItem(item) ? key : ""
    return key
  }
  if (isStreamingItem(item)) return key
  return ""
}

function assistantPlainText(message: Message, partsByMessage: Record<string, Part[]>) {
  return partsOf(message.id, partsByMessage)
    .filter((part): part is TextPart => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
}

export function groupTurns(messages: Message[], partsByMessage: Record<string, Part[]> = {}): TimelineItem[] {
  const items: TimelineItem[] = []
  const turnsByUser = new Map<string, Extract<TimelineItem, { kind: "turn" }>>()
  const compactionsByUser = new Map<string, Extract<TimelineItem, { kind: "compaction" }>>()
  let currentTurn: Extract<TimelineItem, { kind: "turn" }> | undefined

  for (const message of messages) {
    if (message.role === "user") {
      if (isCompactionUser(message, partsByMessage)) {
        const item: Extract<TimelineItem, { kind: "compaction" }> = {
          kind: "compaction",
          id: message.id,
          status: "running",
        }
        items.push(item)
        compactionsByUser.set(message.id, item)
        currentTurn = undefined
        continue
      }
      if (isSystemUser(message, partsByMessage)) {
        currentTurn = undefined
        continue
      }
      const item: Extract<TimelineItem, { kind: "turn" }> = { kind: "turn", user: message, assistants: [] }
      items.push(item)
      turnsByUser.set(message.id, item)
      currentTurn = item
      continue
    }

    const info = message as AssistantMessage
    const pending = info.parentID ? compactionsByUser.get(info.parentID) : undefined
    const parent = info.parentID ? turnsByUser.get(info.parentID) : undefined
    const tail = items[items.length - 1]
    const absorb =
      isCompactionAssistant(message) ||
      Boolean(pending) ||
      (!parent && tail?.kind === "compaction" && tail.status === "running" && !currentTurn)
    if (absorb) {
      const target = pending ?? (tail?.kind === "compaction" ? tail : undefined)
      const aborted = isAbortError(info.error)
      const status = aborted ? "running" : info.error ? "error" : assistantSettled(message) ? "done" : "running"
      const summary = assistantPlainText(message, partsByMessage) || undefined
      const error =
        !aborted && info.error
          ? formatSessionErrorMessage(info.error.data?.message) || "Context compaction failed"
          : undefined
      if (target) {
        target.status = status
        if (summary) target.summary = summary
        if (error) target.error = error
      } else {
        items.push({ kind: "compaction", id: info.parentID ?? info.id, status, summary, error })
      }
      continue
    }

    if (parent) {
      parent.assistants.push(message)
      continue
    }
    if (!currentTurn) {
      currentTurn = { kind: "turn", assistants: [] }
      items.push(currentTurn)
    }
    currentTurn.assistants.push(message)
  }
  return items
}

export function isVisiblePart(part: Part) {
  if (HIDDEN.has(part.type)) return false
  // 部分模型只返回加密 reasoning（text 为空，内容在 metadata.reasoningEncryptedContent 里，
  // 已在线上 DB 确认），没有可展示的文字就直接隐藏，避免点开 Thinking 后看到空面板；
  // 流式文本进来后会自动出现。
  if (part.type === "reasoning") return Boolean((part as ReasoningPart).text?.trim())
  if (part.type === "tool" && (part as { tool?: string }).tool === "todowrite") {
    return part.state.status === "completed" || part.state.status === "error"
  }
  if (part.type === "tool" && (part as { tool?: string }).tool === "question") {
    return part.state.status === "completed" || part.state.status === "error"
  }
  if (part.type === "text" && (part as TextPart).ignored) return false
  if (part.type === "text" && (part as TextPart).synthetic) return false
  return true
}

function collectParts(assistants: Message[], partsByMessage: Record<string, Part[]>) {
  const list: Part[] = []
  for (const message of assistants) {
    for (const part of partsByMessage[message.id] ?? []) {
      if (isVisiblePart(part)) list.push(part)
    }
  }
  return list
}

function partsPlainText(parts: Part[]) {
  const texts = parts
    .filter((part): part is TextPart => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
  if (texts.length) return texts.join("\n\n")
  return parts
    .filter((part): part is FilePart => part.type === "file")
    .map((part) => part.filename || part.url || "附件")
    .join("\n")
}

function formatAgentLabel(agent?: string) {
  const value = (agent ?? "build").toLowerCase()
  if (value === "plan") return "Plan"
  if (value === "build") return "Build"
  return agent ? `${agent.charAt(0).toUpperCase()}${agent.slice(1)}` : "Build"
}

function formatSentTime(value?: number) {
  if (!value) return ""
  const ms = value < 1e12 ? value * 1000 : value
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return ""
  const hh = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })
  const now = new Date()
  if (date.toDateString() === now.toDateString()) return hh
  const day = `${date.getMonth() + 1}/${date.getDate()}`
  if (date.getFullYear() === now.getFullYear()) return `${day} ${hh}`
  return `${date.getFullYear()}/${day} ${hh}`
}

function MessageMeta(props: {
  agent?: string
  modelName: string
  time?: number
  copyText: string
  onRollback?: () => void
}) {
  const copy = async (event: MouseEvent) => {
    event.stopPropagation()
    const text = props.copyText.trim()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // ignore
    }
  }

  const info = () =>
    [formatAgentLabel(props.agent), props.modelName, formatSentTime(props.time)].filter(Boolean).join(" · ")

  return (
    <div class="msg-meta">
      <span class="msg-meta-info">{info()}</span>
      <button type="button" class="msg-meta-copy" aria-label="复制" title="复制" onClick={(event) => void copy(event)}>
        <Icon name="copy" />
      </button>
      <Show when={props.onRollback}>
        {(rollback) => (
          <button
            type="button"
            class="msg-meta-copy rollback"
            aria-label="回滚"
            title="回滚到这条提问之前"
            onClick={(event) => {
              event.stopPropagation()
              rollback()()
            }}
          >
            <Icon name="undo" />
          </button>
        )}
      </Show>
    </div>
  )
}

function useModelName() {
  const models = useModels()
  return (providerID?: string, modelID?: string) => models.nameFor(providerID, modelID)
}

function MessagePartView(props: { part: Part; plain?: boolean }) {
  return (
    <Switch>
      <Match when={props.part.type === "text"}>
        <Show when={props.plain} fallback={<MarkdownView text={(props.part as TextPart).text} />}>
          <div class="user-text">{(props.part as TextPart).text}</div>
        </Show>
      </Match>
      <Match when={props.part.type === "file"}>
        <div class="file-chip">{(props.part as FilePart).filename || (props.part as FilePart).url || "附件"}</div>
      </Match>
      <Match when={props.part.type === "agent"}>
        <div class="agent-chip">@{(props.part as AgentPart).name}</div>
      </Match>
      <Match when={props.part.type === "retry"}>
        <div class="retry-chip">重试 #{(props.part as RetryPart).attempt}</div>
      </Match>
    </Switch>
  )
}

function UserBubble(props: { message: Message; parts: Part[] }) {
  const parts = createMemo(() => (props.parts ?? []).filter(isVisiblePart))
  const modelNameOf = useModelName()
  const runtime = useRuntime()
  const [confirmOpen, setConfirmOpen] = createSignal(false)
  const user = () => props.message as UserMessage
  const runRollback = () => {
    setConfirmOpen(false)
    void runtime.revertToMessage(props.message.id)
  }
  return (
    <article class="turn" data-role="user">
      <div class="turn-stack">
        <div class="user-bubble">
          <For each={parts()}>{(part) => <MessagePartView part={part} plain />}</For>
        </div>
        <MessageMeta
          agent={user().agent}
          modelName={modelNameOf(user().model?.providerID, user().model?.modelID)}
          time={user().time.created}
          copyText={partsPlainText(parts())}
          onRollback={runtime.busy() ? undefined : () => setConfirmOpen(true)}
        />
      </div>
      <Show when={confirmOpen()}>
        <div
          class="dialog-overlay"
          onKeyDown={(event) => {
            if (event.key === "Escape") setConfirmOpen(false)
          }}
        >
          <div class="dialog confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="rollback-dialog-title">
            <header class="dialog-head">
              <h2 id="rollback-dialog-title">回滚到这条提问之前？</h2>
              <button type="button" class="icon-btn" aria-label="关闭" onClick={() => setConfirmOpen(false)}>
                <Icon name="times" />
              </button>
            </header>
            <p class="dialog-hint">
              这条提问之后的所有改动都会被丢弃（discard all changes），项目将恢复到这条提问之前的状态；
              这条提问的内容会放回输入框，便于修改后重新发送。
            </p>
            <div class="dialog-actions">
              <button type="button" class="ghost-btn" autofocus onClick={() => setConfirmOpen(false)}>
                取消
              </button>
              <button type="button" class="send-btn stop" onClick={runRollback}>
                回滚
              </button>
            </div>
          </div>
        </div>
      </Show>
    </article>
  )
}

function ActivityBlocks(props: {
  getBlocks: () => ActivityBlock[]
  live: boolean
  opened: () => Record<string, boolean>
  onToggle: (key: string) => void
}) {
  return (
    <Index each={props.getBlocks()}>
      {(block, index) => (
        <Show
          when={block().kind === "work"}
          fallback={<For each={block().parts}>{(part) => <MessagePartView part={part} />}</For>}
        >
          <WorkGroup
            getParts={() => block().parts}
            live={
              props.live &&
              (isWorkLive(block().parts) ||
                (index === props.getBlocks().length - 1 && block().kind === "work"))
            }
            open={props.opened()[block().key] === true}
            onToggle={() => props.onToggle(block().key)}
          />
        </Show>
      )}
    </Index>
  )
}

function WorkedFor(props: { durationMs: number; children: JSX.Element }) {
  const [open, setOpen] = createSignal(false)
  return (
    <div class="worked-for" classList={{ open: open() }}>
      <button type="button" class="work-head" onClick={() => setOpen((value) => !value)} aria-expanded={open()}>
        <span class="work-summary">
          <span class="work-summary-text work-summary-parts">
            <span class="work-summary-action">Worked for</span>{" "}
            <span class="work-summary-detail">{formatDuration(props.durationMs)}</span>
          </span>
          <Icon name="chevron-right" class="work-summary-caret" />
        </span>
      </button>
      <Show when={open()}>
        <div class="worked-for-body">{props.children}</div>
      </Show>
    </div>
  )
}

function AssistantTurn(props: {
  assistants: Message[]
  partsByMessage: Record<string, Part[]>
  live: boolean
}) {
  const [opened, setOpened] = createSignal<Record<string, boolean>>({})
  const parts = createMemo(() => collectParts(props.assistants, props.partsByMessage))
  const blocks = createMemo(() => groupActivityBlocks(parts()))
  const split = createMemo(() => splitProcessAndAnswer(blocks()))
  const hasWork = createMemo(() => split().process.some((block) => block.kind === "work"))
  const durationMs = createMemo(() => workDurationMs(props.assistants, parts()))
  const files = createMemo(() => changedFiles(parts()))
  const modelNameOf = useModelName()
  const lastAssistant = createMemo(() => {
    const last = [...props.assistants].reverse().find((message) => message.role === "assistant")
    return last?.role === "assistant" ? (last as AssistantMessage) : undefined
  })
  const lastError = createMemo(() => lastAssistant()?.error)
  const stopped = createMemo(() => isAbortError(lastError()))
  const runtime = useRuntime()
  const interrupted = createMemo(() => isInterruptedTurn(props.live, runtime.busy(), lastAssistant()))
  const error = createMemo(() => (stopped() ? "" : formatSessionErrorMessage(lastError()?.data?.message ?? "")))
  const copyText = createMemo(() => {
    const answerParts = split().answer.flatMap((block) => block.parts)
    return partsPlainText(answerParts.length ? answerParts : parts())
  })
  const toggle = (key: string) => {
    setOpened((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  createEffect(() => {
    if (!props.live) setOpened({})
  })

  return (
    <article class="turn" data-role="assistant">
      <div class="assistant-body">
        <Show when={props.live && blocks().length === 0}>
          <WorkGroup parts={[]} live />
        </Show>
        <Show
          when={!props.live && hasWork()}
          fallback={
            <ActivityBlocks
              getBlocks={() => blocks()}
              live={props.live}
              opened={opened}
              onToggle={toggle}
            />
          }
        >
          <>
            <WorkedFor durationMs={durationMs()}>
              <ActivityBlocks
                getBlocks={() => split().process}
                live={false}
                opened={opened}
                onToggle={toggle}
              />
            </WorkedFor>
            <ActivityBlocks
              getBlocks={() => split().answer}
              live={false}
              opened={() => ({})}
              onToggle={() => undefined}
            />
          </>
        </Show>
        <Show when={stopped()}>
          <div class="stop-mark">Stopped</div>
        </Show>
        <Show when={interrupted()}>
          <div class="stop-mark">Interrupted</div>
        </Show>
        <Show when={error()}>
          <div class="error-card">{error()}</div>
        </Show>
        <Show when={!props.live && files().length > 0}>
          <ChangedFiles files={files()} />
        </Show>
      </div>
      <Show when={!props.live && lastAssistant()}>
        {(message) => (
          <MessageMeta
            agent={message().agent ?? message().mode}
            modelName={modelNameOf(message().providerID, message().modelID)}
            time={message().time.completed ?? message().time.created}
            copyText={copyText()}
          />
        )}
      </Show>
    </article>
  )
}

export function CompactionMark(props: { live: boolean; status: "running" | "done" | "error"; summary?: string; error?: string }) {
  const [open, setOpen] = createSignal(false)
  const projects = useProjects()
  const summary = () => props.summary?.trim() ?? ""
  const expandable = () => !props.live && Boolean(summary())
  const liveLabel = () => (projects.connection() === "disconnected" ? "Reconnecting…" : "Compacting context")
  const label = () => compactionLabel(props.status)

  return (
    <div class="compaction-mark" classList={{ live: props.live, open: open(), failed: props.status === "error" }}>
      <Show
        when={props.live}
        fallback={
          <>
            <Show
              when={expandable()}
              fallback={
                <div class="work-summary">
                  <span class="work-summary-text">{label()}</span>
                </div>
              }
            >
              <button
                type="button"
                class="work-head"
                onClick={() => setOpen((value) => !value)}
                aria-expanded={open()}
              >
                <span class="work-summary">
                  <span class="work-summary-text">{label()}</span>
                  <Icon name="chevron-right" class="work-summary-caret" />
                </span>
              </button>
            </Show>
            <Show when={open() && summary()}>
              <div class="compaction-body">
                <MarkdownView text={summary()} />
              </div>
            </Show>
            <Show when={props.status === "error"}>
              <div class="error-card">{props.error || "Context compaction failed"}</div>
            </Show>
          </>
        }
      >
        <div class="compaction-live">
          <span class="work-status-wave">{liveLabel()}</span>
        </div>
      </Show>
    </div>
  )
}

export function ChatTurnView(props: {
  turn: ChatTurn
  partsByMessage: Record<string, Part[]>
  live: boolean
}) {
  return (
    <>
      <Show when={props.turn.user}>
        {(user) => <UserBubble message={user()} parts={props.partsByMessage[user().id] ?? []} />}
      </Show>
      <Show when={props.turn.assistants.length > 0}>
        <AssistantTurn
          assistants={props.turn.assistants}
          partsByMessage={props.partsByMessage}
          live={props.live}
        />
      </Show>
    </>
  )
}
