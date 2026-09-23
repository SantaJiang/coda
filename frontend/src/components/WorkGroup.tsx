import { For, Index, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import {
  activityDiff,
  activityFailureCount,
  activityStatus,
  activitySummary,
  stepBody,
  stepLabel,
  stepPresentation,
} from "../lib/activity"
import type { Part, ReasoningPart } from "../lib/types"
import { useProjects, useRuntime } from "../store/app"
import { MarkdownView } from "./MarkdownView"
import { Icon } from "./Icon"

const IDLE_HOLD_MS = 680
const TOOL_HOLD_MS = 90
const FLIP_MS = 320

function isIdleStatus(label: string) {
  return label === "Thinking" || label === "Thought"
}

function sameStatus(a: string, b: string) {
  if (!a || !b) return false
  if (a === b) return true
  return (a === "Thinking" && b === "Thought") || (a === "Thought" && b === "Thinking")
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

export function WorkGroup(props: {
  parts?: Part[]
  getParts?: () => Part[]
  live: boolean
  open?: boolean
  onToggle?: () => void
}) {
  const [localOpen, setLocalOpen] = createSignal(false)
  const [openSteps, setOpenSteps] = createSignal<Record<string, boolean>>({})
  const [line, setLine] = createSignal({ current: "", previous: "", flipping: false, tick: 0 })
  const [clock, setClock] = createSignal(0)
  const runtime = useRuntime()
  const projects = useProjects()
  const parts = createMemo(() => (props.getParts ? props.getParts() : (props.parts ?? [])))
  const asking = createMemo(() => runtime.pendingQuestions().length > 0)
  const reconnecting = createMemo(() => projects.connection() === "disconnected")
  const liveStatus = () => {
    if (!props.live) return ""
    if (reconnecting()) return "Reconnecting…"
    if (asking()) return "Asking questions"
    return activityStatus(parts(), Date.now())
  }
  const summary = createMemo(() => activitySummary(parts()))
  const summaryParts = createMemo(() => {
    const [action = "", ...detail] = summary().split(" ")
    return { action, detail: detail.join(" ") }
  })
  const diff = createMemo(() => activityDiff(parts()))
  const failures = createMemo(() => activityFailureCount(parts()))
  const thoughtOnly = createMemo(() => {
    const list = parts()
    return list.length > 0 && list.every((part) => part.type === "reasoning")
  })
  const stepParts = createMemo(() =>
    parts().filter((part) => part.type === "tool" || part.type === "reasoning"),
  )
  const thoughtParts = createMemo(() => parts().filter((part) => part.type === "reasoning"))
  const showHead = createMemo(() => Boolean(summary()) && !(props.live && thoughtOnly()))
  const expandable = createMemo(() => parts().length > 0 || (props.live && !reconnecting()))
  const statusToggle = createMemo(() => props.live && !showHead())
  const open = () => (props.onToggle ? Boolean(props.open) : localOpen())
  const toggle = (event?: MouseEvent) => {
    event?.preventDefault()
    event?.stopPropagation()
    if (!expandable()) return
    if (props.onToggle) props.onToggle()
    else setLocalOpen((value) => !value)
  }
  const toggleStep = (id: string) => {
    setOpenSteps((value) => ({ ...value, [id]: !value[id] }))
  }

  let shown = ""
  let tick = 0
  let pending: number | undefined
  let flipTimer: number | undefined

  const commit = (next: string, animate: boolean) => {
    if (sameStatus(next, shown)) return
    const previous = shown
    shown = next
    window.clearTimeout(flipTimer)
    const shouldFlip = Boolean(animate && previous && !prefersReducedMotion())
    if (shouldFlip) tick += 1
    setLine({
      current: next,
      previous: shouldFlip ? previous : "",
      flipping: shouldFlip,
      tick,
    })
    if (!shouldFlip) return
    flipTimer = window.setTimeout(() => {
      if (shown !== next) return
      setLine({ current: next, previous: "", flipping: false, tick })
    }, FLIP_MS)
  }

  createEffect(() => {
    if (!props.live) {
      setClock(0)
      return
    }
    const id = window.setInterval(() => setClock((value) => value + 1), 500)
    onCleanup(() => window.clearInterval(id))
  })

  createEffect(
    on(
      () => {
        clock()
        return liveStatus()
      },
      (next) => {
        window.clearTimeout(pending)
        pending = undefined
        if (!next) {
          shown = ""
          setLine({ current: "", previous: "", flipping: false, tick })
          return
        }
        if (sameStatus(next, shown)) return
        if (!shown) {
          commit(next, false)
          return
        }
        const delay = isIdleStatus(next) ? IDLE_HOLD_MS : TOOL_HOLD_MS
        pending = window.setTimeout(() => {
          const latest = liveStatus()
          if (!latest || sameStatus(latest, shown)) return
          commit(latest, true)
        }, delay)
      },
    ),
  )

  onCleanup(() => {
    window.clearTimeout(pending)
    window.clearTimeout(flipTimer)
  })

  return (
    <div class="work-group" classList={{ open: open(), live: props.live, failed: failures() > 0 }}>
      <Show when={showHead()}>
        <button
          type="button"
          class="work-head"
          onClick={toggle}
          aria-expanded={open()}
          disabled={!parts().length}
        >
          <span class="work-summary">
            <span class="work-summary-text work-summary-parts">
              <span class="work-summary-action">{summaryParts().action}</span>
              <Show when={summaryParts().detail}>
                {" "}<span class="work-summary-detail">{summaryParts().detail}</span>
              </Show>
            </span>
            <Show when={diff()}>
              {(value) => (
                <span class="work-diff">
                  <Show when={value().added > 0}>
                    <span class="work-diff-add">+{value().added}</span>
                  </Show>
                  <Show when={value().removed > 0}>
                    <span class="work-diff-del">-{value().removed}</span>
                  </Show>
                </span>
              )}
            </Show>
            <Show when={failures() > 0}>
              <span class="work-failure">{failures()} failed</span>
            </Show>
            <Show when={parts().length}>
              <Icon name="chevron-right" class="work-summary-caret" />
            </Show>
          </span>
        </button>
      </Show>
      <Show when={open()}>
        <div class="work-steps">
          <Show
            when={thoughtOnly()}
            fallback={
              <Index each={stepParts()}>
                {(part) => (
                  <WorkStep
                    part={part()}
                    open={openSteps()[part().id] === true}
                    onToggle={() => toggleStep(part().id)}
                  />
                )}
              </Index>
            }
          >
            <Index each={thoughtParts()}>
              {(part) => (
                <div class="work-step-body reasoning-inline">
                  <MarkdownView text={(part() as ReasoningPart).text} />
                </div>
              )}
            </Index>
          </Show>
        </div>
      </Show>
      <Show when={props.live && line().current}>
        <button
          type="button"
          class="work-status-head"
          onClick={statusToggle() ? toggle : undefined}
          aria-expanded={statusToggle() ? open() : undefined}
          disabled={!statusToggle() || !expandable()}
        >
          <span class="work-status" role="status" aria-live="polite" aria-atomic="true" aria-label={line().current}>
            <For each={[line().tick]}>
              {() => (
                <span class="work-status-flip" classList={{ flipping: line().flipping }}>
                  <Show when={line().previous}>
                    <span class="work-status-line out">{line().previous}</span>
                  </Show>
                  <span class="work-status-line in">
                    <span class="work-status-wave">{line().current}</span>
                  </span>
                </span>
              )}
            </For>
          </span>
          <Show when={statusToggle() && expandable()}>
            <Icon name="chevron-right" class="work-summary-caret" />
          </Show>
        </button>
      </Show>
    </div>
  )
}

function WorkStep(props: { part: Part; open: boolean; onToggle: () => void }) {
  const label = createMemo(() => stepLabel(props.part))
  const presentation = createMemo(() => stepPresentation(props.part))
  const body = createMemo(() => stepBody(props.part).trim())
  const running = () => {
    if (props.part.type !== "tool") return false
    const status = (props.part as { state?: { status?: string } }).state?.status
    return status === "pending" || status === "running"
  }
  const failed = () => props.part.type === "tool" && props.part.state.status === "error"

  return (
    <div class="work-step" classList={{ open: props.open, running: running(), failed: failed() }}>
      <button
        type="button"
        class="work-step-head"
        onClick={() => body() && props.onToggle()}
        disabled={!body()}
        aria-expanded={body() ? props.open : undefined}
        aria-label={label()}
      >
        <span class="work-step-label" aria-hidden="true">
          <span class="work-step-text">
            <span class="work-step-action">{presentation().action}</span>
            <Show when={presentation().detail}>
              {" "}<span class="work-step-detail">{presentation().detail}</span>
            </Show>
            <Show when={presentation().context}>
              {" "}<span class="work-step-context">{presentation().context}</span>
            </Show>
          </span>
          <Show when={body()}>
            <Icon name="chevron-right" class="work-step-caret" />
          </Show>
        </span>
      </button>
      <Show when={props.open && body()}>
        <Show
          when={props.part.type === "reasoning"}
          fallback={<pre class="work-step-body">{body()}</pre>}
        >
          <div class="work-step-body reasoning-inline">
            <MarkdownView text={(props.part as ReasoningPart).text} />
          </div>
        </Show>
      </Show>
    </div>
  )
}
