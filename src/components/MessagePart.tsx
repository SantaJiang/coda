import { For, Match, Show, Switch, createMemo, createSignal } from "solid-js"
import type {
  AgentPart,
  AssistantMessage,
  FilePart,
  Message,
  Part,
  ReasoningPart,
  RetryPart,
  TextPart,
  ToolPart,
} from "../lib/types"
import { MarkdownView } from "./MarkdownView"
import { ToolCard } from "./ToolCard"

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
  if (part.type === "tool" && (part as ToolPart).tool === "todowrite") return false
  if (part.type === "tool" && (part as ToolPart).tool === "question") return false
  if (part.type === "text" && (part as TextPart).ignored) return false
  if (part.type === "text" && (part as TextPart).synthetic) return false
  return true
}

function formatWorked(ms: number) {
  const sec = Math.max(1, Math.round(ms / 1000))
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m <= 0) return `Worked for ${s}s`
  return `Worked for ${m}m ${s}s`
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

function turnDuration(assistants: Message[], parts: Part[]) {
  const first = assistants[0] as AssistantMessage | undefined
  const start = first?.time.created
  let end = 0
  for (const message of assistants) {
    if (message.role !== "assistant") continue
    if (message.time.completed) end = Math.max(end, message.time.completed)
  }
  for (const part of parts) {
    if (part.type !== "tool") continue
    const state = (part as ToolPart).state
    if (state.status === "completed" || state.status === "error") {
      const ended = state.time?.end
      if (ended) end = Math.max(end, ended)
    }
  }
  if (!start) return 0
  if (!end) end = Date.now()
  return Math.max(0, end - start)
}

function MessagePartView(props: { part: Part }) {
  return (
    <Switch>
      <Match when={props.part.type === "text"}>
        <MarkdownView text={(props.part as TextPart).text} />
      </Match>
      <Match when={props.part.type === "reasoning"}>
        <details class="reasoning">
          <summary>思考过程</summary>
          <MarkdownView text={(props.part as ReasoningPart).text} />
        </details>
      </Match>
      <Match when={props.part.type === "tool"}>
        <ToolCard part={props.part as ToolPart} />
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
  return (
    <article class="turn" data-role="user">
      <div class="user-bubble">
        <For each={parts()}>{(part) => <MessagePartView part={part} />}</For>
      </div>
    </article>
  )
}

function AssistantTurn(props: {
  assistants: Message[]
  partsByMessage: Record<string, Part[]>
  live: boolean
}) {
  const [expanded, setExpanded] = createSignal(false)
  const parts = createMemo(() => collectParts(props.assistants, props.partsByMessage))
  const process = createMemo(() => parts().filter((part) => part.type === "tool" || part.type === "reasoning"))
  const answer = createMemo(() =>
    parts().filter((part) => {
      if (part.type === "tool" || part.type === "reasoning") return false
      if (part.type === "text") return Boolean((part as TextPart).text?.trim())
      return true
    }),
  )
  const running = createMemo(() =>
    process().some(
      (part) =>
        part.type === "tool" &&
        ((part as ToolPart).state.status === "pending" || (part as ToolPart).state.status === "running"),
    ),
  )
  const summarizing = createMemo(() => process().length > 0 && answer().length > 0 && !running())
  const done = createMemo(() => process().length > 0 && !props.live && !running())
  const collapsed = createMemo(() => (summarizing() || done()) && !expanded())
  const error = createMemo(() => {
    const last = [...props.assistants].reverse().find((message) => message.role === "assistant")
    return last?.role === "assistant" ? last.error?.data?.message : undefined
  })

  return (
    <article class="turn" data-role="assistant">
      <div class="assistant-body">
        <Show when={(summarizing() || done()) && process().length > 0}>
          <button
            type="button"
            class="worked"
            title={expanded() ? "收起过程" : "点击展开过程"}
            onClick={() => setExpanded((value) => !value)}
          >
            <span>{formatWorked(turnDuration(props.assistants, parts()))}</span>
            <span class="worked-hint">{expanded() ? "收起" : "点击展开"}</span>
          </button>
        </Show>
        <Show when={!collapsed()}>
          <For each={process()}>{(part) => <MessagePartView part={part} />}</For>
        </Show>
        <For each={answer()}>{(part) => <MessagePartView part={part} />}</For>
        <Show when={error()}>
          <div class="error-card">{error()}</div>
        </Show>
      </div>
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
