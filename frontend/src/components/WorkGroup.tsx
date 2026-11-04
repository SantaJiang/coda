import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import type { JSX } from "solid-js"
import { activityDiff, activityFailureCount, stepPresentation } from "../lib/activity"
import { blockTitle, type BlockShape } from "../lib/step-grouping"
import { toolActivity } from "../lib/conversation"
import type { ConversationEntry } from "../lib/conversation"
import { childSessionStub, isSubagentTool, subagentDescription, subagentSessionID } from "../lib/subagent"
import { meaningfulThought, thinkingBody } from "../lib/thinking"
import type { Part, ReasoningPart } from "../lib/types"
import { useProjects } from "../store/app"
import { MarkdownView } from "./MarkdownView"
import { Icon } from "./Icon"

const TITLE_GAP = 200

/**
 * Glass Agent Transcript activity group:
 * - Closed: one summary row (no 144px preview).
 * - Open: group head + per-step ThinkingLine / tool / short-prose rows.
 * Thought bodies stay collapsed until the Thought row is clicked (same as tools).
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

  const pureThought = createMemo(() => parts().length > 0 && parts().every((part) => part.type !== "tool"))
  const reasoningKeys = createMemo(() => props.entries.flatMap((entry) => entry.kind === "part" && entry.part.type === "reasoning" && thinkingBody(entry.part) ? [entry.key] : []))
  const expandable = createMemo(() => parts().some((part) => part.type === "tool" || part.type === "text") || reasoningKeys().length > 0)
  const failures = createMemo(() => activityFailureCount(parts()))
  const diff = createMemo(() => activityDiff(parts()))
  const map = createMemo(() => new Map(props.entries.map((entry) => [entry.key, entry])))

  // Thought bodies never auto-open. Stuck stepOpen from old live-reveal is forced shut.
  // A click while streaming is a live preview and closes when that thought ends (Glass);
  // a click on a finished Thought stays open until the user collapses it.
  const userOpened = new Set<string>()
  const openedWhileLive = new Set<string>()
  createEffect(() => {
    for (const entry of props.entries) {
      if (entry.kind !== "part" || entry.part.type !== "reasoning") continue
      if (props.stepOpen[entry.key] !== true) continue
      const finished = Number.isFinite(entry.part.time?.end)
      if (finished && openedWhileLive.has(entry.key)) {
        openedWhileLive.delete(entry.key)
        userOpened.delete(entry.key)
        props.onCollapseStep?.(entry.key)
        continue
      }
      if (!userOpened.has(entry.key)) props.onCollapseStep?.(entry.key)
    }
  })
  const toggleThought = (key: string, part: ReasoningPart, target: HTMLElement) => {
    const opening = props.stepOpen[key] !== true
    if (opening) {
      userOpened.add(key)
      if (!Number.isFinite(part.time?.end)) openedWhileLive.add(key)
    } else {
      userOpened.delete(key)
      openedWhileLive.delete(key)
    }
    props.onToggleStep(key, target)
  }

  // Pure live group uses loadingAction "Thinking"; otherwise throttled completed/tool summary.
  const headTitle = createMemo(() => {
    if (props.active && pureThought()) return "Thinking"
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
          // Always list Thought/Thinking rows (live and finished). Bodies stay collapsed
          // unless the user clicks — never dump blank-heavy markdown into the stream.
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
            <Show when={entry().kind === "part" && part().type === "reasoning"}>
              <ThinkingLine
                part={part() as ReasoningPart}
                open={props.stepOpen[key] === true}
                active={props.active}
                onToggle={(target) => toggleThought(key, part() as ReasoningPart, target)}
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

function prefersReducedMotion() {
  if (typeof window.matchMedia !== "function") return true
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/** Cursor Glass collapsible: keep body mounted while height/opacity animate closed. */
type ThoughtMotion = "open" | "closing" | "closed"

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
  const [motion, setMotion] = createSignal<ThoughtMotion>(props.open && body() ? "open" : "closed")
  let closeTimer: number | undefined
  const finishClose = () => {
    window.clearTimeout(closeTimer)
    closeTimer = undefined
    if (motion() === "closing") setMotion("closed")
  }
  createEffect(() => {
    const text = body()
    window.clearTimeout(closeTimer)
    closeTimer = undefined
    if (props.open && text) {
      setMotion("open")
      return
    }
    if (!props.open && motion() === "open") {
      if (!text || prefersReducedMotion()) {
        setMotion("closed")
        return
      }
      setMotion("closing")
      // Fallback if animationend is skipped (display:none / reduced path races).
      closeTimer = window.setTimeout(finishClose, 260)
    }
  })
  onCleanup(() => window.clearTimeout(closeTimer))
  const showBody = () => {
    const phase = motion()
    return Boolean(body()) && (phase === "open" || phase === "closing")
  }
  const onCollapseEnd: JSX.EventHandlerUnion<HTMLDivElement, AnimationEvent> = (event) => {
    if (motion() !== "closing") return
    const name = event.animationName || ""
    if (name && !name.includes("thinking-collapse-rows")) return
    finishClose()
  }
  // Never render an empty Thinking husk — those became lone `>` / blank rows on hover.
  return <Show when={expandable()}>
    <div class="work-step thinking-line" classList={{ open: showBody() && motion() === "open", closing: motion() === "closing" }}>
      <button type="button" class="work-step-head"
        aria-expanded={showBody() && motion() === "open"}
        onClick={(event) => props.onToggle(event.currentTarget)}>
        <span class="work-step-label">
          <span class="work-step-text">
            <span class="work-step-action">{presentation().action}</span>
            <Show when={presentation().detail}> <span class="work-step-detail">{presentation().detail}</span></Show>
          </span>
          <Icon name="chevron-right" class="work-step-caret" />
        </span>
      </button>
      <Show when={showBody()}>
        <div
          class="thinking-collapse"
          classList={{ open: motion() === "open", closing: motion() === "closing" }}
          onAnimationEnd={onCollapseEnd}
        >
          <div class="thinking-collapse-inner">
            <div class="thinking-body" role="region" aria-label="思考过程">
              <MarkdownView text={body()} streaming={props.active && live() && motion() === "open"} />
            </div>
          </div>
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
  const projects = useProjects()
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
  const subagent = () => {
    const part = tool()
    return part && isSubagentTool(part) ? part : undefined
  }
  const childID = createMemo(() => {
    const part = subagent()
    if (!part) return undefined
    const direct = subagentSessionID(part)
    if (direct) return direct
    const parent = projects.selectedSession()
    if (!parent) return undefined
    const label = subagentDescription(part)
    const path = parent.directory
    const match = projects.sessionsFor(path).find(
      (session) => session.parentID === parent.id && (!label || session.title === label),
    )
    return match?.id
  })
  const openChild = () => {
    const part = subagent()
    const id = childID()
    const parent = projects.selectedSession()
    if (!part || !id || !parent) return
    const existing = projects.sessionsFor(parent.directory).find((session) => session.id === id)
    const agent = typeof part.state.input?.agent === "string" ? part.state.input.agent : undefined
    void projects.selectSession(
      existing ??
        childSessionStub({
          id,
          directory: parent.directory,
          title: subagentDescription(part) || "Subagent",
          parentID: parent.id,
          agent,
        }),
    )
  }
  // Same interaction as Thought rows: hover + click whenever there is detail to show.
  const expandable = () => Boolean(parameters() || output() || running() || childID())
  const failed = () => tool()?.state.status === "error"
  const stateLabel = () => {
    const part = tool()
    if (!part) return ""
    if (part.state.status === "error") return "失败"
    if (part.state.status === "completed") return ""
    if (props.inactive) return "未完成"
    return ""
  }
  const onHeadClick = (event: MouseEvent & { currentTarget: HTMLElement }) => {
    // Cursor: Task card click opens the child agent. Keep expand for details via caret/second click when already linked.
    if (subagent() && childID() && !props.open) {
      event.preventDefault()
      openChild()
      return
    }
    props.onToggle(event.currentTarget)
  }
  return <div class="work-step" classList={{ open: props.open, running: running(), failed: failed(), subagent: Boolean(subagent()) }}>
    <button type="button" class="work-step-head" onClick={onHeadClick} disabled={!expandable()}
      aria-expanded={expandable() ? props.open : undefined}>
      <span class="work-step-label">
        <span class="work-step-text"><span class="work-step-action">{presentation().action}</span>
          <Show when={presentation().detail}> <span class="work-step-detail">{presentation().detail}</span></Show>
          <Show when={presentation().context}> <span class="work-step-context">{presentation().context}</span></Show>
        </span>
        <Show when={stateLabel()}><span class="step-state">{stateLabel()}</span></Show>
        <Show when={subagent() && childID()}><span class="step-open-child">打开</span></Show>
        <Show when={expandable()}><Icon name="chevron-right" class="work-step-caret" /></Show>
      </span>
    </button>
    <Show when={failed() && !props.open}><div class="step-error-preview">{output()}</div></Show>
    <Show when={props.open && expandable()}>
      <div class="tool-details">
        <Show when={subagent() && childID()}>
          <button type="button" class="subagent-open-link" onClick={openChild}>查看子代理会话</button>
        </Show>
        <Show when={parameters()}><div class="detail-label">参数</div><pre class="work-step-body">{parameters()}</pre></Show>
        <Show when={output()}><div class="detail-label">{failed() ? "错误" : "输出"}</div><pre class="work-step-body">{output()}</pre></Show>
        <Show when={running() && !output()}><div class="detail-label">{toolActivity(tool()!)}，等待输出</div></Show>
      </div>
    </Show>
  </div>
}
