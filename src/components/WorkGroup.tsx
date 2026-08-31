import { For, Show, createMemo, createSignal } from "solid-js"
import { activityFlip, activitySummary } from "../lib/activity"
import type { Part, ReasoningPart, ToolPart } from "../lib/types"
import { MarkdownView } from "./MarkdownView"
import { ToolCard } from "./ToolCard"

export function WorkGroup(props: { parts: Part[]; live: boolean }) {
  const [open, setOpen] = createSignal(false)
  const summary = createMemo(() => activitySummary(props.parts))
  const flip = createMemo(() => activityFlip(props.parts))
  const toggle = () => setOpen((value) => !value)

  return (
    <div class="work-group" classList={{ open: open() }}>
      <Show when={summary()}>
        <button type="button" class="work-summary" onClick={toggle}>
          {summary()}
        </button>
      </Show>
      <Show when={props.live}>
        <button type="button" class="work-flip" onClick={toggle} aria-label={flip()}>
          <span class="work-flip-window">
            <Show when={flip()} keyed>
              {(label) => <span class="work-flip-line">{label}</span>}
            </Show>
          </span>
        </button>
      </Show>
      <Show when={open()}>
        <div class="work-steps">
          <For each={props.parts}>
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
