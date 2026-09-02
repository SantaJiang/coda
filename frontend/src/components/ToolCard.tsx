import { Show, createMemo, createSignal } from "solid-js"
import type { ToolPart } from "../lib/types"

const LABELS: Record<string, string> = {
  read: "读取",
  write: "写入",
  edit: "编辑",
  bash: "终端",
  shell: "终端",
  glob: "匹配文件",
  grep: "搜索",
  list: "列出目录",
  ls: "列出目录",
  webfetch: "抓取网页",
  websearch: "网络搜索",
  task: "子任务",
}

function preview(input?: Record<string, unknown>) {
  if (!input) return ""
  const path = (input.path ?? input.file_path ?? input.command ?? input.pattern ?? input.url ?? input.query) as
    | string
    | undefined
  return path ? String(path) : ""
}

export function ToolCard(props: { part: ToolPart }) {
  const [open, setOpen] = createSignal(false)
  const label = createMemo(() => LABELS[props.part.tool] ?? props.part.tool)
  const title = createMemo(() => {
    const state = props.part.state
    const named = "title" in state ? state.title : undefined
    return named || preview(state.input) || label()
  })
  const status = () => props.part.state.status
  const body = createMemo(() => {
    if (props.part.state.status === "completed") return props.part.state.output ?? ""
    if (props.part.state.status === "error") return props.part.state.error ?? ""
    return JSON.stringify(props.part.state.input ?? {}, null, 2)
  })

  return (
    <div class="tool-card" data-status={status()}>
      <button type="button" class="tool-head" onClick={() => setOpen((value) => !value)}>
        <span class="tool-status" data-status={status()} />
        <span class="tool-name">{label()}</span>
        <span class="tool-title">{title()}</span>
        <Show when={status() === "running" || status() === "pending"}>
          <span class="spinner" />
        </Show>
      </button>
      <Show when={open()}>
        <pre class="tool-body">{body()}</pre>
      </Show>
    </div>
  )
}
