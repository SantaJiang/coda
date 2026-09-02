import { Show, createEffect, createMemo } from "solid-js"
import { useApp } from "../store/app"
import { AttachmentStrip } from "./AttachmentStrip"
import { ComposerPlus } from "./ComposerPlus"
import { ModelMenu } from "./ModelMenu"
import { PermissionMenu } from "./PermissionMenu"
import { VariantMenu } from "./VariantMenu"
import { Icon } from "./Icon"

const COMPOSER_MAX_HEIGHT = 220

export function Composer() {
  const app = useApp()
  let area: HTMLTextAreaElement | undefined

  const placeholder = createMemo(() => {
    if (!app.selectedProject()) return "先添加一个项目文件夹"
    if (!app.selectedModel()) return "先配置一个模型"
    if (app.blocked()) return "请先处理权限或提问"
    if (app.busy()) return "Agent 正在工作，Enter 可停止…"
    return "发给 Agent 一条消息"
  })

  const canSend = createMemo(
    () =>
      !!app.selectedProject() &&
      !app.blocked() &&
      (app.busy() || !!app.state.composer.trim() || app.state.attachments.length > 0),
  )

  const resize = () => {
    if (!area) return
    if (!app.state.composer) {
      area.style.height = ""
      return
    }
    area.style.height = "auto"
    area.style.height = `${Math.min(area.scrollHeight, COMPOSER_MAX_HEIGHT)}px`
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
      <AttachmentStrip />
      <textarea
        ref={area}
        rows={1}
        value={app.state.composer}
        disabled={!app.selectedProject() || app.blocked()}
        placeholder={placeholder()}
        onInput={(event) => app.setState("composer", event.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      <div class="composer-bar">
        <div class="composer-left">
          <ComposerPlus />
          <Show when={app.state.planMode}>
            <div class="plan-chip">
              <span>Plan</span>
              <button type="button" class="plan-chip-x" aria-label="退出 Plan" onClick={() => app.setPlanMode(false)}>
                <Icon name="times" />
              </button>
            </div>
          </Show>
          <ModelMenu />
          <VariantMenu />
          <PermissionMenu />
        </div>
        <button
          type="button"
          class="send-btn"
          classList={{ stop: app.busy() }}
          disabled={!canSend()}
          onClick={() => (app.busy() && !app.state.composer.trim() ? void app.abort() : void app.send())}
        >
          {app.busy() && !app.state.composer.trim() ? "停止" : "发送"}
        </button>
      </div>
    </div>
  )
}
