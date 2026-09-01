import { For, Show, createMemo, createSignal } from "solid-js"
import { activityDiff, activitySummary, isWorkLive, stepBody, stepLabel } from "../lib/activity"
import type { Part, ReasoningPart } from "../lib/types"
import { MarkdownView } from "./MarkdownView"
import { Icon } from "./Icon"

export function WorkGroup(props: {
  parts?: Part[]
  getParts?: () => Part[]
  live: boolean
  open?: boolean
  onToggle?: () => void
}) {
  const [localOpen, setLocalOpen] = createSignal(false)
  const parts = createMemo(() => (props.getParts ? props.getParts() : (props.parts ?? [])))
  const live = createMemo(() => props.live && isWorkLive(parts()))
  const summary = createMemo(() => activitySummary(parts()) || (props.live ? "Thinking" : ""))
  const diff = createMemo(() => activityDiff(parts()))
  const open = () => (props.onToggle ? Boolean(props.open) : localOpen())
  const toggle = (event?: MouseEvent) => {
    event?.preventDefault()
    event?.stopPropagation()
    if (!parts().length) return
    if (props.onToggle) props.onToggle()
    else setLocalOpen((value) => !value)
  }

  return (
    <div
      class="work-group"
      classList={{ open: open(), live: live() || (props.live && !parts().length) }}
    >
      <Show when={summary()}>
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
              <Icon name="caret-right" class="work-summary-caret" />
            </Show>
          </span>
        </button>
      </Show>
      <Show when={open()}>
        <div class="work-steps">
          <For each={parts()}>
            {(part) =>
              part.type === "tool" || part.type === "reasoning" ? <WorkStep part={part} /> : null
            }
          </For>
        </div>
      </Show>
    </div>
  )
}

function WorkStep(props: { part: Part }) {
  const [open, setOpen] = createSignal(false)
  const label = createMemo(() => stepLabel(props.part))
  const body = createMemo(() => stepBody(props.part).trim())
  const running = () =>
    props.part.type === "tool" &&
    (props.part.state.status === "pending" || props.part.state.status === "running")

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
