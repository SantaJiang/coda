import { createEffect, createMemo, createSignal } from "solid-js"
import { useApp } from "../store/app"

export function Composer() {
  const app = useApp()
  let area: HTMLTextAreaElement | undefined
  const [rows, setRows] = createSignal(1)

  const placeholder = createMemo(() => {
    if (!app.selectedProject()) return "先添加一个项目文件夹"
    if (app.blocked()) return "请先处理权限或提问"
    if (app.busy()) return "Agent 正在工作，Enter 可停止…"
    return "发给 Agent 一条消息"
  })

  const resize = () => {
    if (!area) return
    area.style.height = "auto"
    const next = Math.min(area.scrollHeight, 220)
    area.style.height = `${next}px`
    setRows(Math.min(8, Math.max(1, Math.round(next / 22))))
  }

  createEffect(() => {
    app.state.composer
    queueMicrotask(resize)
  })

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      void app.send()
    }
  }

  return (
    <div class="composer">
      <textarea
        ref={area}
        rows={rows()}
        value={app.state.composer}
        disabled={!app.selectedProject() || app.blocked()}
        placeholder={placeholder()}
        onInput={(event) => app.setState("composer", event.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      <div class="composer-bar">
        <span class="model-chip">DeepSeek V4 Flash</span>
        <button
          type="button"
          class="send-btn"
          classList={{ stop: app.busy() }}
          disabled={!app.selectedProject() || app.blocked() || (!app.state.composer.trim() && !app.busy())}
          onClick={() => (app.busy() && !app.state.composer.trim() ? void app.abort() : void app.send())}
        >
          {app.busy() && !app.state.composer.trim() ? "停止" : "发送"}
        </button>
      </div>
    </div>
  )
}
