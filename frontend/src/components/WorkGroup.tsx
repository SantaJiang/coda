import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { activityDiff, activityStatus, activitySummary, stepBody, stepLabel } from "../lib/activity"
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
  const diff = createMemo(() => activityDiff(parts()))
  const thoughtOnly = createMemo(() => {
    const list = parts()
    return list.length > 0 && list.every((part) => part.type === "reasoning")
  })
  const showHead = createMemo(() => Boolean(summary()) && !(props.live && thoughtOnly()))
  const open = () => (props.onToggle ? Boolean(props.open) : localOpen())
  const toggle = (event?: MouseEvent) => {
    event?.preventDefault()
    event?.stopPropagation()
    if (!parts().length) return
    if (props.onToggle) props.onToggle()
    else setLocalOpen((value) => !value)
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
    <div class="work-group" classList={{ open: open(), live: props.live }}>
      <Show when={showHead()}>
        <button
          type="button"
          class="work-head"
          onClick={toggle}
          aria-expanded={open()}
          disabled={!parts().length}
        >
          <span class="work-summary">
            <span class="work-summary-text">{summary()}</span>
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
            <Show when={parts().length}>
              <Icon name="chevron-right" class="work-summary-caret" />
            </Show>
          </span>
        </button>
      </Show>
      <Show when={props.live && line().current}>
        <div class="work-status" aria-label={line().current}>
          <For each={[line().tick]}>
            {() => (
              <div class="work-status-flip" classList={{ flipping: line().flipping }}>
                <Show when={line().previous}>
                  <span class="work-status-line out">{line().previous}</span>
                </Show>
                <span class="work-status-line in">
                  <span class="work-status-wave">{line().current}</span>
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={open() && showHead()}>
        <div class="work-steps">
          <Show
            when={thoughtOnly()}
            fallback={
              <For each={parts()}>
                {(part) =>
                  part.type === "tool" || part.type === "reasoning" ? <WorkStep part={part} /> : null
                }
              </For>
            }
          >
            <For each={parts()}>
              {(part) =>
                part.type === "reasoning" ? (
                  <div class="work-step-body reasoning-inline">
                    <MarkdownView text={(part as ReasoningPart).text} />
                  </div>
                ) : null
              }
            </For>
          </Show>
        </div>
      </Show>
    </div>
  )
}

function WorkStep(props: { part: Part }) {
  const [open, setOpen] = createSignal(false)
  const label = createMemo(() => stepLabel(props.part))
  const body = createMemo(() => stepBody(props.part).trim())
  const running = () => {
    if (props.part.type !== "tool") return false
    const status = (props.part as { state?: { status?: string } }).state?.status
    return status === "pending" || status === "running"
  }

  return (
    <div class="work-step" classList={{ open: open(), running: running() }}>
      <button
        type="button"
        class="work-step-head"
        onClick={() => body() && setOpen((value) => !value)}
        disabled={!body()}
      >
        <span class="work-step-label">{label()}</span>
      </button>
      <Show when={open() && body()}>
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
