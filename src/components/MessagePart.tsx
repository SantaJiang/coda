import { For, Index, Match, Show, Switch, type JSX, createEffect, createMemo, createSignal } from "solid-js"
import {
  changedFiles,
  formatWorkedFor,
  groupActivityBlocks,
  splitProcessAndAnswer,
  workDurationMs,
  type ActivityBlock,
} from "../lib/activity"
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
import { ChangedFiles } from "./ChangedFiles"

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
            live={props.live}
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
          <span class="work-summary-caret" aria-hidden="true">
            ›
          </span>
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
  const error = createMemo(() => {
    const last = [...props.assistants].reverse().find((message) => message.role === "assistant")
    return last?.role === "assistant" ? last.error?.data?.message : undefined
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
