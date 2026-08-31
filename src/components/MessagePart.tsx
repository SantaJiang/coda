import { For, Match, Show, Switch, createMemo } from "solid-js"
import { groupActivityBlocks } from "../lib/activity"
import type {
  AgentPart,
  FilePart,
  Message,
  Part,
  RetryPart,
  TextPart,
} from "../lib/types"
import { MarkdownView } from "./MarkdownView"
import { WorkGroup } from "./WorkGroup"

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
  const parts = createMemo(() => collectParts(props.assistants, props.partsByMessage))
  const blocks = createMemo(() => groupActivityBlocks(parts()))
  const error = createMemo(() => {
    const last = [...props.assistants].reverse().find((message) => message.role === "assistant")
    return last?.role === "assistant" ? last.error?.data?.message : undefined
  })

  return (
    <article class="turn" data-role="assistant">
      <div class="assistant-body">
        <Show when={props.live && blocks().length === 0}>
          <WorkGroup parts={[]} live />
        </Show>
        <For each={blocks()}>
          {(block, index) => (
            <Show
              when={block.kind === "work"}
              fallback={
                <For each={block.parts}>{(part) => <MessagePartView part={part} />}</For>
              }
            >
              <WorkGroup
                parts={block.parts}
                live={props.live && index() === blocks().length - 1}
              />
            </Show>
          )}
        </For>
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
