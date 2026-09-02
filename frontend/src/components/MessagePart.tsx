import { For, Index, Match, Show, Switch, type JSX, createEffect, createMemo, createSignal } from "solid-js"
import {
  changedFiles,
  formatWorkedFor,
  groupActivityBlocks,
  isWorkLive,
  splitProcessAndAnswer,
  workDurationMs,
  type ActivityBlock,
} from "../lib/activity"
import { modelKey } from "../lib/models"
import type {
  AgentPart,
  AssistantMessage,
  FilePart,
  Message,
  Part,
  RetryPart,
  TextPart,
  UserMessage,
} from "../lib/types"
import { useApp } from "../store/app"
import { MarkdownView } from "./MarkdownView"
import { WorkGroup } from "./WorkGroup"
import { ChangedFiles } from "./ChangedFiles"
import { Icon } from "./Icon"

const HIDDEN = new Set(["step-start", "step-finish", "patch", "snapshot", "compaction"])

export type ChatTurn = {
  user?: Message
  assistants: Message[]
}

export function groupTurns(messages: Message[]): ChatTurn[] {
  const turns: ChatTurn[] = []
  for (const message of messages) {
    if (message.role === "user") {
      turns.push({ user: message, assistants: [] })
      continue
    }
    if (turns.length === 0) turns.push({ assistants: [] })
    turns[turns.length - 1].assistants.push(message)
  }
  return turns
}

function isVisiblePart(part: Part) {
  if (HIDDEN.has(part.type)) return false
  if (part.type === "tool" && (part as { tool?: string }).tool === "todowrite") return false
  if (part.type === "tool" && (part as { tool?: string }).tool === "question") return false
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

function MessageMeta(props: { agent?: string; modelName: string; time?: number; copyText: string }) {
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
    </div>
  )
}

function useModelName() {
  const app = useApp()
  return (providerID?: string, modelID?: string) => {
    if (!modelID && !providerID) return ""
    if (providerID && modelID) {
      const key = modelKey(providerID, modelID)
      const named =
        app.selectableModels().find((item) => item.key === key) ??
        app.state.discoveredModels.find((item) => item.key === key) ??
        app.state.configuredModels.find((item) => item.providerID === providerID && item.modelID === modelID)
      if (named && "name" in named && named.name) return named.name
    }
    return modelID || providerID || ""
  }
}

function MessagePartView(props: { part: Part }) {
  return (
    <Switch>
      <Match when={props.part.type === "text"}>
        <MarkdownView text={(props.part as TextPart).text} />
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
  const user = () => props.message as UserMessage
  return (
    <article class="turn" data-role="user">
      <div class="turn-stack">
        <div class="user-bubble">
          <For each={parts()}>{(part) => <MessagePartView part={part} />}</For>
        </div>
        <MessageMeta
          agent={user().agent}
          modelName={modelNameOf(user().model?.providerID, user().model?.modelID)}
          time={user().time.created}
          copyText={partsPlainText(parts())}
        />
      </div>
    </article>
  )
}

function ActivityBlocks(props: {
  getBlocks: () => ActivityBlock[]
  live: boolean
  opened: () => Record<number, boolean>
  onToggle: (index: number) => void
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
            open={props.opened()[index] === true}
            onToggle={() => props.onToggle(index)}
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
          <span class="work-summary-text">{formatWorkedFor(props.durationMs)}</span>
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
  const [opened, setOpened] = createSignal<Record<number, boolean>>({})
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
  const error = createMemo(() => lastAssistant()?.error?.data?.message)
  const copyText = createMemo(() => {
    const answerParts = split().answer.flatMap((block) => block.parts)
    return partsPlainText(answerParts.length ? answerParts : parts())
  })
  const toggle = (index: number) => {
    setOpened((prev) => ({ ...prev, [index]: !prev[index] }))
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
