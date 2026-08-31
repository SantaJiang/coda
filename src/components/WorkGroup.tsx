import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { activityFlip, activitySummary } from "../lib/activity"
import type { Part, ReasoningPart, ToolPart } from "../lib/types"
import { MarkdownView } from "./MarkdownView"
import { ToolCard } from "./ToolCard"

const FLIP_HOLD_MS = 600

export function WorkGroup(props: {
  parts?: Part[]
  getParts?: () => Part[]
  live: boolean
  open?: boolean
  onToggle?: () => void
}) {
  const [localOpen, setLocalOpen] = createSignal(false)
  const [flipLine, setFlipLine] = createSignal({ label: "Planning next moves", animate: false })
  const parts = createMemo(() => (props.getParts ? props.getParts() : (props.parts ?? [])))
  const summary = createMemo(() => activitySummary(parts()))
  const flip = createMemo(() => activityFlip(parts()))
  const open = () => (props.onToggle ? Boolean(props.open) : localOpen())
  const toggle = (event?: MouseEvent) => {
    event?.preventDefault()
    event?.stopPropagation()
    if (props.onToggle) props.onToggle()
    else setLocalOpen((value) => !value)
  }

  let lastFlip = ""
  let hold: number | undefined
  createEffect(() => {
    const next = flip()
    window.clearTimeout(hold)
    if (next === lastFlip) return
    if (!lastFlip) {
      lastFlip = next
      setFlipLine({ label: next, animate: false })
      return
    }
    hold = window.setTimeout(() => {
      if (next === lastFlip) return
      lastFlip = next
      setFlipLine({ label: next, animate: true })
    }, FLIP_HOLD_MS)
  })
  onCleanup(() => window.clearTimeout(hold))

  return (
    <div class="work-group" classList={{ open: open() }}>
      <button type="button" class="work-head" onClick={toggle} aria-expanded={open()}>
        <Show when={summary()}>
          <span class="work-summary">
            <span class="work-summary-text">{summary()}</span>
            <span class="work-summary-caret" aria-hidden="true">
              ›
            </span>
          </span>
        </Show>
        <Show when={props.live}>
          <span class="work-flip" aria-label={flipLine().label}>
            <span class="work-flip-window">
              <span class="work-flip-line" classList={{ animate: flipLine().animate }} data-label={flipLine().label}>
                {flipLine().label}
              </span>
            </span>
          </span>
        </Show>
      </button>
      <Show when={open()}>
        <div class="work-steps">
          <For each={parts()}>
            {(part) =>
              part.type === "tool" ? (
                <ToolCard part={part as ToolPart} />
              ) : part.type === "reasoning" ? (
                <details class="reasoning" open>
                  <summary>思考过程</summary>
                  <MarkdownView text={(part as ReasoningPart).text} />
                </details>
              ) : null
            }
          </For>
        </div>
      </Show>
    </div>
  )
}
