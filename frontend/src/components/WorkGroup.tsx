import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { activityDiff, activityFailureCount, stepPresentation } from "../lib/activity"
import { blockTitle, type BlockShape } from "../lib/step-grouping"
import { toolActivity } from "../lib/conversation"
import type { ConversationEntry } from "../lib/conversation"
import { meaningfulThought, thinkingBody } from "../lib/thinking"
import type { Part, ReasoningPart } from "../lib/types"
import { MarkdownView } from "./MarkdownView"
import { Icon } from "./Icon"

const TITLE_GAP = 200

/**
 * Glass Agent Transcript activity group:
 * - Closed: one summary row (no 144px preview).
 * - Open pure-thought: group head + markdown body (no ThinkingLine chrome).
 * - Open mixed: group head (tool verb) + per-step ThinkingLine / tool rows.
 * Live generating/running status is suppressed only while this live group is open.
 */
export function WorkGroup(props: {
  entries: ConversationEntry[]
  shape?: BlockShape
  open: boolean
  onToggle: (target: HTMLElement) => void
  inactive: boolean
  active: boolean
  stepOpen: Record<string, boolean>
  onToggleStep: (key: string, target: HTMLElement) => void
  onRevealThoughts: (keys: string[]) => void
  onCollapseStep?: (key: string) => void
}) {
  const parts = createMemo(() => props.entries.flatMap((entry) => entry.kind === "part" ? [entry.part] : []))
  const shape = () => props.shape ?? "group"
  const summary = createMemo(() => blockTitle(props.entries, shape()))
  const [title, setTitle] = createSignal(summary())
  let latestTitle = summary()
  let titleAt = 0
  let titleTimer: number | undefined
  const flushTitle = () => {
    titleTimer = undefined
    titleAt = Date.now()
    setTitle(latestTitle)
  }
  createEffect(() => {
    latestTitle = summary()
    const wait = props.active ? Math.max(0, TITLE_GAP - (Date.now() - titleAt)) : 0
    window.clearTimeout(titleTimer)
    titleTimer = window.setTimeout(flushTitle, wait)
  })
  onCleanup(() => window.clearTimeout(titleTimer))

  const thinkingAsMarkdown = createMemo(() => parts().length > 0 && parts().every((part) => part.type !== "tool"))
  const reasoningKeys = createMemo(() => props.entries.flatMap((entry) => entry.kind === "part" && entry.part.type === "reasoning" && thinkingBody(entry.part) ? [entry.key] : []))
  const expandable = createMemo(() => parts().some((part) => part.type === "tool" || part.type === "text") || reasoningKeys().length > 0)
  const failures = createMemo(() => activityFailureCount(parts()))
  const diff = createMemo(() => activityDiff(parts()))
  const map = createMemo(() => new Map(props.entries.map((entry) => [entry.key, entry])))

  // Pure-thought was open as markdown; tools arrived → keep those thoughts open as ThinkingLines.
  let wasMarkdownOpen = false
  createEffect(() => {
    const markdown = thinkingAsMarkdown()
    if (props.open && wasMarkdownOpen && !markdown && reasoningKeys().length) props.onRevealThoughts(reasoningKeys())
    wasMarkdownOpen = props.open && markdown
  })

  // Glass: an opened live ThinkingLine collapses itself once that thought finishes.
  const liveThought = new Map<string, boolean>()
  createEffect(() => {
    for (const entry of props.entries) {
      if (entry.kind !== "part" || entry.part.type !== "reasoning") continue
      const live = !Number.isFinite(entry.part.time?.end)
      const was = liveThought.get(entry.key)
      liveThought.set(entry.key, live)
      if (was === true && !live && props.stepOpen[entry.key] === true) props.onCollapseStep?.(entry.key)
    }
  })

  // Pure live group uses loadingAction "Thinking"; otherwise throttled completed/tool summary.
  const headTitle = createMemo(() => {
    if (props.active && thinkingAsMarkdown()) return "Thinking"
    return title()
  })

  return <div class="work-group" classList={{ open: props.open, live: props.active, failed: failures() > 0 }}>
    <button type="button" class="work-head" disabled={!expandable()} aria-expanded={expandable() ? props.open : undefined}
      onClick={(event) => props.onToggle(event.currentTarget)}>
      <span class="work-summary">
        <span class="work-summary-text">{headTitle()}</span>
        <Show when={!props.active && diff()}>{(value) => <span class="work-diff"><Show when={value().added}><span class="work-diff-add">+{value().added}</span></Show><Show when={value().removed}><span class="work-diff-del">-{value().removed}</span></Show></span>}</Show>
        <Show when={failures()}><span class="work-failure">{failures()} 项失败</span></Show>
        <Show when={expandable()}><Icon name="chevron-right" class="work-summary-caret" /></Show>
      </span>
    </button>
    <Show when={props.open && expandable()}>
      <div class="work-steps">
        <For each={props.entries.flatMap((entry) => {
          if (entry.kind !== "part") return []
          if (entry.part.type === "reasoning") return thinkingBody(entry.part) ? [entry.key] : []
          if (entry.part.type === "text") return meaningfulThought(entry.part.text) ? [entry.key] : []
          if (entry.part.type === "tool") return [entry.key]
          return []
        })}>{(key) => {
          const entry = () => map().get(key)!
          const part = () => (entry() as { part: Part }).part
          return <div data-entry-key={key}>
            <Show when={entry().kind === "part" && part().type === "text" && meaningfulThought(partText(part()))}>
              <div class="work-grouped-text"><MarkdownView text={partText(part())} /></div>
            </Show>
            <Show when={entry().kind === "part" && part().type === "reasoning" && thinkingAsMarkdown()}>
              <Show when={thinkingBody(part() as ReasoningPart)}>
                {(body) => (
                  <div class="thinking-body" role="region" aria-label="思考过程">
                    <MarkdownView text={body()} streaming={props.active && !Number.isFinite((part() as ReasoningPart).time?.end)} />
                  </div>
                )}
              </Show>
            </Show>
            <Show when={entry().kind === "part" && part().type === "reasoning" && !thinkingAsMarkdown()}>
              <ThinkingLine
                part={part() as ReasoningPart}
                open={props.stepOpen[key] === true}
                active={props.active}
                onToggle={(target) => props.onToggleStep(key, target)}
              />
            </Show>
            <Show when={entry().kind === "part" && part().type === "tool"}>
              <ToolStep part={part()} open={props.stepOpen[key] === true} onToggle={(target) => props.onToggleStep(key, target)} inactive={props.inactive} />
            </Show>
          </div>
        }}</For>
      </div>
    </Show>
  </div>
}

function partText(part: Part) {
  return part.type === "text" ? part.text : ""
}

export { thinkingBody } from "../lib/thinking"

function ThinkingLine(props: {
  part: ReasoningPart
  open: boolean
  active: boolean
  onToggle: (target: HTMLElement) => void
}) {
  const live = () => !Number.isFinite(props.part.time?.end)
  const body = () => thinkingBody(props.part)
  const expandable = () => Boolean(body())
  const presentation = createMemo(() => {
    if (live()) return { action: "Thinking", detail: "" }
    const line = stepPresentation(props.part)
    return { action: line.action, detail: line.detail ?? "" }
  })
  // Never render an empty Thinking husk — those became lone `>` / blank rows on hover.
  return <Show when={expandable()}>
    <div class="work-step thinking-line" classList={{ open: props.open }}>
      <button type="button" class="work-step-head"
        aria-expanded={props.open}
        onClick={(event) => props.onToggle(event.currentTarget)}>
        <span class="work-step-label">
          <span class="work-step-text">
            <span class="work-step-action">{presentation().action}</span>
            <Show when={presentation().detail}> <span class="work-step-detail">{presentation().detail}</span></Show>
          </span>
          <Icon name="chevron-right" class="work-step-caret" />
        </span>
      </button>
      <Show when={props.open}>
        <div class="thinking-body" role="region" aria-label="思考过程">
          <MarkdownView text={body()} streaming={props.active && live()} />
        </div>
      </Show>
    </div>
  </Show>
}

function ToolStep(props: {
  part: Part
  open: boolean
  onToggle: (target: HTMLElement) => void
  inactive: boolean
}) {
  const tool = () => props.part.type === "tool" ? props.part : undefined
  const running = () => !props.inactive && (tool()?.state.status === "pending" || tool()?.state.status === "running")
  const presentation = createMemo(() => stepPresentation(props.part, { live: running() }))
  const parameters = () => tool()?.tool === "question" ? "" : tool()?.state.input ? JSON.stringify(tool()!.state.input, null, 2) : ""
  const output = () => {
    const state = tool()?.state
    if (!state) return ""
    if (state.status === "completed") return state.output ?? ""
    if (state.status === "error") return state.error ?? ""
    return ""
  }
  // Same interaction as Thought rows: hover + click whenever there is detail to show.
  const expandable = () => Boolean(parameters() || output() || running())
  const failed = () => tool()?.state.status === "error"
  const stateLabel = () => {
    const part = tool()
    if (!part) return ""
    if (part.state.status === "error") return "失败"
    if (part.state.status === "completed") return ""
    if (props.inactive) return "未完成"
    return ""
  }
  return <div class="work-step" classList={{ open: props.open, running: running(), failed: failed() }}>
    <button type="button" class="work-step-head" onClick={(event) => props.onToggle(event.currentTarget)} disabled={!expandable()}
      aria-expanded={expandable() ? props.open : undefined}>
      <span class="work-step-label">
        <span class="work-step-text"><span class="work-step-action">{presentation().action}</span>
          <Show when={presentation().detail}> <span class="work-step-detail">{presentation().detail}</span></Show>
          <Show when={presentation().context}> <span class="work-step-context">{presentation().context}</span></Show>
        </span>
        <Show when={stateLabel()}><span class="step-state">{stateLabel()}</span></Show>
        <Show when={expandable()}><Icon name="chevron-right" class="work-step-caret" /></Show>
      </span>
    </button>
    <Show when={failed() && !props.open}><div class="step-error-preview">{output()}</div></Show>
    <Show when={props.open && expandable()}>
      <div class="tool-details">
        <Show when={parameters()}><div class="detail-label">参数</div><pre class="work-step-body">{parameters()}</pre></Show>
        <Show when={output()}><div class="detail-label">{failed() ? "错误" : "输出"}</div><pre class="work-step-body">{output()}</pre></Show>
        <Show when={running() && !output()}><div class="detail-label">{toolActivity(tool()!)}，等待输出</div></Show>
      </div>
    </Show>
  </div>
}
