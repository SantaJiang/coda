import { For, Show, createEffect, createMemo } from "solid-js"
import { activityDiff, activityFailureCount, activitySummary, reasoningDurationMs, formatDuration, stepPresentation } from "../lib/activity"
import { toolActivity } from "../lib/conversation"
import type { ConversationEntry } from "../lib/conversation"
import type { Part } from "../lib/types"
import { MarkdownView } from "./MarkdownView"
import { Icon } from "./Icon"

export function WorkGroup(props: {
  entries: ConversationEntry[]
  open: boolean
  onToggle: () => void
  inactive: boolean
  active: boolean
  status: string
  stepOpen: Record<string, boolean>
  onToggleStep: (key: string) => void
  onRevealThoughts: (keys: string[]) => void
}) {
  const parts = createMemo(() => props.entries.flatMap((entry) => entry.kind === "part" ? [entry.part] : []))
  const summary = createMemo(() => activitySummary(parts()))
  const thoughtOnly = createMemo(() => parts().every((part) => part.type === "reasoning"))
  const expandable = createMemo(() => parts().some((part) => part.type === "tool" || (part.type === "reasoning" && Boolean(part.text.trim()))))
  const statusLeads = () => props.active && thoughtOnly() && parts().some((part) => part.type === "reasoning" && !Number.isFinite(part.time?.end))
  const failures = createMemo(() => activityFailureCount(parts()))
  const diff = createMemo(() => activityDiff(parts()))
  const map = createMemo(() => new Map(props.entries.map((entry) => [entry.key, entry])))
  createEffect(() => {
    // Keep inspected reasoning open when the same activity group later gains tools.
    if (props.open && thoughtOnly()) props.onRevealThoughts(props.entries.map((entry) => entry.key))
  })
  return <div class="work-group" classList={{ open: props.open, live: props.active, failed: failures() > 0 }}>
    <button type="button" class={statusLeads() ? "work-head work-status-head" : "work-head"}
      disabled={!expandable()} aria-expanded={expandable() ? props.open : undefined} onClick={props.onToggle}>
      <span class="work-summary">
        <span class={statusLeads() ? "work-status-wave" : "work-summary-text"}
          role={statusLeads() ? "status" : undefined} aria-live={statusLeads() ? "polite" : undefined}>
          {statusLeads() ? props.status : summary()}
        </span>
        <Show when={diff()}>{(value) => <span class="work-diff"><Show when={value().added}><span class="work-diff-add">+{value().added}</span></Show><Show when={value().removed}><span class="work-diff-del">-{value().removed}</span></Show></span>}</Show>
        <Show when={failures()}><span class="work-failure">{failures()} 项失败</span></Show>
        <Show when={expandable()}><Icon name="chevron-right" class="work-summary-caret" /></Show>
      </span>
    </button>
    <Show when={props.open && expandable()}>
      <div class="work-steps">
        <For each={props.entries.map((entry) => entry.key)}>{(key) => {
          const part = () => (map().get(key)! as { part: Part }).part
          return <div data-entry-key={key}>
            <WorkStep part={part()} headless={thoughtOnly()} open={props.stepOpen[key] === true || thoughtOnly()} onToggle={() => props.onToggleStep(key)} inactive={props.inactive} />
          </div>
        }}</For>
      </div>
    </Show>
    <Show when={props.active && !statusLeads()}>
      <div class="work-status-head"><span class="work-status-wave" role="status" aria-live="polite" aria-atomic="true">{props.status}</span></div>
    </Show>
  </div>
}

function WorkStep(props: { part: Part; open: boolean; onToggle: () => void; inactive: boolean; headless?: boolean }) {
  const presentation = createMemo(() => {
    if (props.part.type === "reasoning") {
      const duration = reasoningDurationMs([props.part])
      return { action: "Thought", detail: duration === null ? "" : duration < 1000 ? "briefly" : formatDuration(duration), context: "" }
    }
    return stepPresentation(props.part)
  })
  const tool = () => props.part.type === "tool" ? props.part : undefined
  const terminalID = () => { const state = tool()?.state; return state && "metadata" in state && typeof state.metadata?.terminalID === "string" ? state.metadata.terminalID : undefined }
  const thinking = () => props.part.type === "reasoning" ? props.part.text : ""
  const parameters = () => tool()?.tool === "question" ? "" : tool()?.state.input ? JSON.stringify(tool()!.state.input, null, 2) : ""
  const output = () => {
    const state = tool()?.state
    if (!state) return ""
    if (state.status === "completed") return state.output ?? ""
    if (state.status === "error") return state.error ?? ""
    return ""
  }
  const expandable = () => Boolean(thinking().trim() || parameters() || output())
  const running = () => !props.inactive && (tool()?.state.status === "pending" || tool()?.state.status === "running")
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
    <button type="button" class="work-step-head" onClick={props.onToggle} disabled={!expandable()}
      style={{ display: props.headless ? "none" : undefined }}
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
    <Show when={terminalID()}>{(id) => <button class="work-terminal-link" onClick={() => window.dispatchEvent(new CustomEvent("coda:open-terminal", { detail: id() }))}>查看终端</button>}</Show>
    <Show when={failed() && !props.open}><div class="step-error-preview">{output()}</div></Show>
    <Show when={props.open && expandable()}>
      <Show when={props.part.type === "reasoning"} fallback={<div class="tool-details">
        <Show when={parameters()}><div class="detail-label">参数</div><pre class="work-step-body">{parameters()}</pre></Show>
        <Show when={output()}><div class="detail-label">{failed() ? "错误" : "输出"}</div><pre class="work-step-body">{output()}</pre></Show>
        <Show when={running() && !output()}><div class="detail-label">{toolActivity(tool()!)}，等待输出</div></Show>
      </div>}>
        <div class="work-step-body reasoning-inline"><MarkdownView text={thinking()} /></div>
      </Show>
    </Show>
  </div>
}
