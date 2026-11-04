import { For, Match, Show, Switch, createEffect, createMemo, createSignal } from "solid-js"
import { KeyedList } from "./KeyedList"
import { changedFiles, formatDuration, liveShellWaitLabel } from "../lib/activity"
import type { CompactionEntry, ConversationBlock, ConversationEntry, ConversationTurn } from "../lib/conversation"
import { conversationBlocks, runningTool, visibleConversationPart as isVisiblePart } from "../lib/conversation"
import type { ToolPart } from "../lib/types"
import { conversationDensity } from "../lib/density"
import type {
  AgentPart,
  FilePart,
  Message,
  Part,
  RetryPart,
  TextPart,
  UserMessage,
} from "../lib/types"
import { useModels, useRuntime } from "../store/app"
import { MarkdownView } from "./MarkdownView"
import { WorkGroup } from "./WorkGroup"
import { StatusText, useStatusLine } from "./StatusText"
import { ChangedFiles } from "./ChangedFiles"
import { Icon } from "./Icon"

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

function formatRelativeTime(value?: number) {
  if (!value) return ""
  const ms = value < 1e12 ? value * 1000 : value
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return ""
  const delta = Date.now() - date.getTime()
  if (delta < 45_000) return "Just now"
  if (delta < 60 * 60_000) return `${Math.max(1, Math.round(delta / 60_000))}m ago`
  if (delta < 24 * 60 * 60_000) return `${Math.max(1, Math.round(delta / 3_600_000))}h ago`
  return formatSentTime(value)
}

function MessageMeta(props: {
  agent?: string
  modelName: string
  time?: number
  copyText: string
  onRollback?: () => void
  relative?: boolean
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

  const clock = () => (props.relative ? formatRelativeTime(props.time) : formatSentTime(props.time))
  const detail = () => [formatAgentLabel(props.agent), props.modelName, formatSentTime(props.time)].filter(Boolean).join(" · ")
  const info = () => (props.relative ? clock() : detail())

  return (
    <div class="msg-meta" classList={{ "is-assistant": props.relative }}>
      <span class="msg-meta-info" title={props.relative ? detail() : undefined}>{info()}</span>
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

function MessagePartView(props: { part: Part; plain?: boolean; streaming?: boolean }) {
  return (
    <Switch>
      <Match when={props.part.type === "text"}>
        <Show when={props.plain} fallback={<MarkdownView text={(props.part as TextPart).text} streaming={props.streaming} />}>
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
  // Optimistic send + server ack can briefly leave two text parts with the same body.
  const parts = createMemo(() => {
    const visible = (props.parts ?? []).filter(isVisiblePart)
    const out: Part[] = []
    for (const part of visible) {
      const prev = out[out.length - 1]
      if (part.type === "text" && prev?.type === "text" && prev.text === part.text) continue
      out.push(part)
    }
    return out
  })
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
          <KeyedList each={parts()} by={(part) => part.id}>{(part) => <MessagePartView part={part()} plain />}</KeyedList>
        </div>
        <MessageMeta
          agent={user().agent}
          modelName={modelNameOf(user().model?.providerID, user().model?.modelID)}
          time={user().time.created}
          copyText={partsPlainText(parts())}
          onRollback={runtime.busy() || user().delivery ? undefined : () => setConfirmOpen(true)}
        />
      </div>
      <Show when={user().delivery}>
        <div class="delivery-state" role="status">
          <Show when={user().delivery === "sending"} fallback={<>
            <span>{user().delivery === "uncertain" ? "发送结果待确认" : "发送失败"} · {user().deliveryError}</span>
            <button type="button" class="ghost-btn" disabled={runtime.busy()} onClick={() => void runtime.retrySend(user().id)}>重新发送</button>
          </>}><span>发送中</span></Show>
        </div>
      </Show>
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

function EntryList(props: { entries: ConversationEntry[]; fade?: boolean; onInspect?: () => void; beforeLayout?: (target?: HTMLElement) => void; afterLayout?: () => void }) {
  const runtime = useRuntime()
  const map = createMemo(() => new Map(props.entries.map((entry) => [entry.key, entry])))
  const fadeKey = () => props.fade ? [...props.entries].reverse().find((entry) => entry.kind === "part" && entry.part.type === "text")?.key : undefined
  return <For each={props.entries.map((entry) => entry.key)}>{(key) => {
    const entry = () => map().get(key)!
    const open = () => runtime.timelineView().stepOpen[key] === true
    const toggle = (target: HTMLElement) => {
      props.onInspect?.()
      props.beforeLayout?.(target)
      runtime.updateTimelineView({ stepOpen: { ...runtime.timelineView().stepOpen, [key]: !open() } })
      props.afterLayout?.()
    }
    return <div class="conversation-entry" data-entry-key={key}>
      <Show when={entry().kind === "part"} fallback={<CompactionRow entry={entry() as CompactionEntry} open={open()} onToggle={toggle} />}>
        <MessagePartView part={(entry() as { part: Part }).part} streaming={fadeKey() === key} />
      </Show>
    </div>
  }}</For>
}

function BlockList(props: {
  entries: ConversationEntry[]
  active: boolean
  onInspect?: () => void
  beforeLayout?: (target?: HTMLElement) => void
  afterLayout?: () => void
}) {
  const runtime = useRuntime()
  let held: ReturnType<typeof conversationBlocks> = []
  const blocks = createMemo(() => {
    const next = conversationBlocks(props.entries, conversationDensity())
    if (!next.length && props.active && held.length) return held
    held = next
    return next
  })
  const map = createMemo(() => new Map(blocks().map((block) => [block.key, block])))
  const inspect = (target: HTMLElement, change: () => void) => {
    props.onInspect?.()
    props.beforeLayout?.(target)
    change()
    props.afterLayout?.()
  }
  return <For each={blocks().map((block) => block.key)}>{(key) => {
    const block = () => map().get(key)!
    const card = () => block().shape === "card"
    const open = () => card() ? runtime.timelineView().groupOpen?.[key] !== false : runtime.timelineView().groupOpen?.[key] === true
    return <Show when={block().kind === "work"} fallback={
      <EntryList entries={block().entries} fade={props.active} onInspect={props.onInspect} beforeLayout={props.beforeLayout} afterLayout={props.afterLayout} />
    }>
      <div class="conversation-work-block" data-block-key={key} data-scroll-key={key}>
        <WorkGroup entries={block().entries} shape={block().shape} open={open()} onToggle={(target) => inspect(target, () => runtime.updateTimelineView({ groupOpen: { ...runtime.timelineView().groupOpen, [key]: !open() } }))}
          inactive={!props.active} active={props.active && blocks()[blocks().length - 1]?.key === key}
          stepOpen={runtime.timelineView().stepOpen}
          onRevealThoughts={(keys) => {
            const opened = runtime.timelineView().stepOpen
            if (keys.some((key) => opened[key] !== true)) runtime.updateTimelineView({ stepOpen: { ...opened, ...Object.fromEntries(keys.map((key) => [key, true])) } })
          }}
          onCollapseStep={(stepKey) => {
            if (runtime.timelineView().stepOpen[stepKey] === true) {
              runtime.updateTimelineView({ stepOpen: { ...runtime.timelineView().stepOpen, [stepKey]: false } })
            }
          }}
          onToggleStep={(stepKey, target) => inspect(target, () => runtime.updateTimelineView({ stepOpen: { ...runtime.timelineView().stepOpen, [stepKey]: runtime.timelineView().stepOpen[stepKey] !== true } }))} />
      </div>
    </Show>
  }}</For>
}

function CompactionRow(props: { entry: CompactionEntry; open: boolean; onToggle: (target: HTMLElement) => void }) {
  const label = () => ({
    running: "Summarizing chat context",
    done: "Chat context summarized",
    failed: "Summarization failed",
    interrupted: "Summarization stopped",
  })[props.entry.status]
  return <div class="compaction-mark" classList={{ open: props.open, failed: props.entry.status === "failed" }}>
    <button type="button" class="work-head" disabled={!props.entry.summary && !props.entry.error}
      aria-expanded={props.open} onClick={(event) => props.onToggle(event.currentTarget)}>
      <span class="work-summary">
        <span class="work-summary-text">{label()}</span>
        <Show when={props.entry.summary || props.entry.error}><Icon name="chevron-right" class="work-summary-caret" /></Show>
      </span>
    </button>
    <Show when={props.open}>
      <Show when={props.entry.summary}><MarkdownView text={props.entry.summary} /></Show>
      <Show when={props.entry.error}><pre class="work-step-body">{props.entry.error}</pre></Show>
    </Show>
  </div>
}

function WorkedSummary(props: { durationMs: number; failures: number; open: boolean; onToggle: (target: HTMLElement) => void }) {
  return <button type="button" class="work-head" onClick={(event) => props.onToggle(event.currentTarget)} aria-expanded={props.open}>
    <span class="work-summary"><span>Worked for {formatDuration(props.durationMs)}</span>
      <Show when={props.failures}><span class="work-failure">{props.failures} 项失败</span></Show>
      <Icon name="chevron-right" class="work-summary-caret" /></span>
  </button>
}

export function ChatTurnView(props: {
  turn: ConversationTurn
  partsByMessage: Record<string, Part[]>
  following: boolean
  beforeLayout?: (target?: HTMLElement) => void
  afterLayout?: () => void
  onInspect?: () => void
}) {
  const runtime = useRuntime()
  const models = useModels()
  const statusLine = useStatusLine(() => props.turn.label, () => props.turn.active)
  const [grouped, setGrouped] = createSignal(props.turn.phase === "done")
  let initial = true
  createEffect(() => {
    const completed = props.turn.phase === "done"
    const mayGroup = initial || props.following
    initial = false
    if (!completed) setGrouped(false)
    else if (mayGroup && !grouped()) {
      props.beforeLayout?.()
      setGrouped(true)
      props.afterLayout?.()
    }
  })
  const processOpen = () => runtime.timelineView().processOpen[props.turn.id] === true
  const toggleProcess = (target: HTMLElement) => {
    props.onInspect?.()
    props.beforeLayout?.(target)
    runtime.updateTimelineView({ processOpen: { ...runtime.timelineView().processOpen, [props.turn.id]: !processOpen() } })
    props.afterLayout?.()
  }
  const parts = createMemo(() => props.turn.entries.flatMap((entry) => entry.kind === "part" ? [entry.part] : []))
  const files = createMemo(() => changedFiles(parts()))
  const last = () => props.turn.assistants[props.turn.assistants.length - 1]
  const copyText = () => partsPlainText((props.turn.answer.length ? props.turn.answer : props.turn.entries).flatMap((entry) => entry.kind === "part" ? [entry.part] : []))
  const liveBlocks = createMemo(() => conversationBlocks(props.turn.entries, conversationDensity()))
  const tailWork = createMemo((): ConversationBlock | undefined => {
    const tail = liveBlocks()[liveBlocks().length - 1]
    return tail?.kind === "work" ? tail : undefined
  })
  const tailWorkOpen = createMemo(() => {
    const tail = tailWork()
    if (!tail) return false
    const card = tail.shape === "card"
    return card ? runtime.timelineView().groupOpen?.[tail.key] !== false : runtime.timelineView().groupOpen?.[tail.key] === true
  })
  // Glass: don't stack a second Thinking under a pure Thinking group, and suppress
  // ordinary live status while the open group already shows that work — except shell
  // wait countdowns, which otherwise collapse into a blank "Planning next moves".
  const showTurnStatus = createMemo(() => {
    if (props.turn.phase === "done" || props.turn.error) return false
    if (!props.turn.active) return true
    const tail = tailWork()
    if (!tail) return true
    const liveTool = tail.entries.some((entry) => entry.kind === "part" && entry.part.type === "tool" && runningTool(entry.part))
    const liveThought = tail.entries.some(
      (entry) => entry.kind === "part" && entry.part.type === "reasoning" && !Number.isFinite(entry.part.time?.end),
    )
    const hasTool = tail.entries.some((entry) => entry.kind === "part" && entry.part.type === "tool")
    const shellWaiting = tail.entries.some(
      (entry) => entry.kind === "part" && entry.part.type === "tool" && Boolean(liveShellWaitLabel(entry.part as ToolPart)),
    )
    // Closed/open pure Thinking row already is the status — Cursor hides the second line.
    if (liveThought && !hasTool) return false
    if (tailWorkOpen() && (liveTool || liveThought) && !shellWaiting) return false
    return true
  })
  // Cursor: click the second-line status to expand/collapse the owning activity group.
  const toggleTailWork = (target: HTMLElement) => {
    const tail = tailWork()
    if (!tail) return
    const next = !tailWorkOpen()
    props.onInspect?.()
    props.beforeLayout?.(target)
    const view = runtime.timelineView()
    const groupOpen = { ...view.groupOpen, [tail.key]: next }
    if (!next) {
      runtime.updateTimelineView({ groupOpen })
    } else {
      const liveThoughts = tail.entries.flatMap((entry) =>
        entry.kind === "part" && entry.part.type === "reasoning" && !Number.isFinite(entry.part.time?.end) ? [entry.key] : [],
      )
      runtime.updateTimelineView({
        groupOpen,
        ...(liveThoughts.length
          ? { stepOpen: { ...view.stepOpen, ...Object.fromEntries(liveThoughts.map((key) => [key, true])) } }
          : {}),
      })
    }
    props.afterLayout?.()
  }
  return <div class="conversation-turn" data-turn-id={props.turn.id} data-phase={props.turn.phase}>
    <Show when={props.turn.user}>{(user) => <UserBubble message={user()} parts={props.partsByMessage[user().id] ?? []} />}</Show>
    <Show when={!props.turn.user?.delivery}>
      <article class="turn" data-role="assistant">
        <div class="assistant-body">
          <Show when={grouped()} fallback={<>
            <Show when={props.turn.phase === "done" && props.turn.process.length > 0}>
              <div class="worked-for open" data-scroll-key={`status:${props.turn.id}`}>
                <WorkedSummary durationMs={props.turn.durationMs} failures={props.turn.failures} open onToggle={(target) => {
                  props.onInspect?.()
                  props.beforeLayout?.(target)
                  runtime.updateTimelineView({ processOpen: { ...runtime.timelineView().processOpen, [props.turn.id]: false } })
                  setGrouped(true)
                  props.afterLayout?.()
                }} />
              </div>
            </Show>
            <BlockList entries={props.turn.entries} active={props.turn.active}
              onInspect={props.onInspect} beforeLayout={props.beforeLayout} afterLayout={props.afterLayout} />
            <Show when={showTurnStatus()}>
              <div class="turn-status" classList={{ live: props.turn.active, failed: props.turn.phase === "failed" }}>
                <Show when={tailWork()} fallback={<StatusText line={statusLine()} active={props.turn.active} />}>
                  <button type="button" class="work-status-head" aria-expanded={tailWorkOpen()}
                    aria-label={tailWorkOpen() ? "收起活动" : "展开活动"}
                    onClick={(event) => toggleTailWork(event.currentTarget)}>
                    <StatusText line={statusLine()} active={props.turn.active} />
                  </button>
                </Show>
              </div>
            </Show>
          </>}>
            <Show when={props.turn.process.length > 0}>
              <div class="worked-for" classList={{ open: processOpen() }} data-scroll-key={`status:${props.turn.id}`}>
                <WorkedSummary durationMs={props.turn.durationMs} failures={props.turn.failures} open={processOpen()} onToggle={toggleProcess} />
                <Show when={processOpen()}><div class="worked-for-body">
                  <BlockList entries={props.turn.process} active={false} onInspect={props.onInspect} beforeLayout={props.beforeLayout} afterLayout={props.afterLayout} />
                </div></Show>
              </div>
            </Show>
            <div class="final-answer" data-answer-anchor={props.turn.id}><EntryList entries={props.turn.answer} /></div>
            <Show when={!props.turn.answer.length && props.turn.user}><div class="stop-mark">本轮未返回回复正文</div></Show>
          </Show>
          <Show when={props.turn.error}><div class="error-card">{props.turn.error}</div></Show>
          <Show when={!props.turn.active && files().length > 0}><ChangedFiles files={files()} /></Show>
        </div>
          <Show when={!props.turn.active && last()}>{(message) => <MessageMeta
          relative
          agent={message().agent ?? message().mode} modelName={models.nameFor(message().providerID, message().modelID)}
          time={message().time.completed ?? message().time.created} copyText={copyText()} />}</Show>
      </article>
    </Show>
  </div>
}
