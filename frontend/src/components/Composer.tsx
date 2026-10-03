import { Show, createEffect, onCleanup, onMount } from "solid-js"
import { isNewlineHotkey, isSendHotkey } from "../lib/settings"
import { useChrome, useModels, useProjects, useRuntime } from "../store/app"
import { isLocalProject } from "../lib/persist"
import { AttachmentStrip } from "./AttachmentStrip"
import { ComposerPlus } from "./ComposerPlus"
import { ModelMenu } from "./ModelMenu"
import { PermissionMenu } from "./PermissionMenu"
import { VariantMenu } from "./VariantMenu"
import { Icon } from "./Icon"

const COMPOSER_MAX_HEIGHT = 220

export function Composer() {
  const projects = useProjects()
  const models = useModels()
  const runtime = useRuntime()
  const chrome = useChrome()
  let area: HTMLTextAreaElement | undefined
  let composing = false

  const placeholder = () => {
    if (!projects.selectedProject()) return "先添加一个项目文件夹"
    if (projects.selectedProject()?.missing) return "先重新定位项目文件夹"
    if (!models.selectedModel()) return "先配置一个模型"
    if (runtime.blocked()) return "请先处理权限或提问"
    if (runtime.busy()) return "Agent 正在工作，Esc 可停止…"
    if (isLocalProject(projects.selectedProject())) return "不问具体项目也可以，发给 Agent 一条消息"
    return "发给 Agent 一条消息"
  }

  const hasDraft = () => !!runtime.composer().trim() || runtime.attachments().length > 0

  const canSend = () =>
    !!projects.selectedProject() &&
    !projects.selectedProject()?.missing &&
    !runtime.blocked() &&
    (hasDraft() || runtime.busy())

  const resize = () => {
    if (!area) return
    if (!runtime.composer()) {
      area.style.height = ""
      return
    }
    area.style.height = "auto"
    area.style.height = `${Math.min(area.scrollHeight, COMPOSER_MAX_HEIGHT)}px`
  }

  createEffect(() => {
    runtime.composer()
    queueMicrotask(resize)
  })

  // textarea 不用 value 绑定做受控组件：Solid 每次输入都回写 node.value 会
  // 重置光标并打断 IME 组合，导致 "" 自动配对、智能引号变成 ”” 之类的乱码。
  // 只有外部改动（发送清空、恢复草稿等）且不在组合输入中时才回写 DOM。
  createEffect(() => {
    const next = runtime.composer()
    if (!area || composing || area.value === next) return
    area.value = next
    resize()
  })

  const onCompositionEnd = () => {
    composing = false
    if (area) runtime.setComposer(area.value)
  }

  const stopIfBusy = () => {
    if (!runtime.busy() || runtime.blocked() || chrome.overlayOpen()) return false
    void runtime.abort()
    return true
  }

  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return
      const target = event.target as HTMLElement | null
      if (target?.closest(".dialog-overlay, .context-menu, .model-menu")) return
      if (target?.closest("input, textarea, select") && !target.closest(".composer")) return
      if (stopIfBusy()) event.preventDefault()
    }
    document.addEventListener("keydown", onKey)
    onCleanup(() => document.removeEventListener("keydown", onKey))
  })

  const insertNewline = () => {
    if (!area) return
    area.focus()
    const start = area.selectionStart ?? area.value.length
    const end = area.selectionEnd ?? start
    const inserted = typeof document.execCommand === "function" && document.execCommand("insertText", false, "\n")
    if (!inserted) {
      area.value = `${area.value.slice(0, start)}\n${area.value.slice(end)}`
      area.setSelectionRange(start + 1, start + 1)
    }
    runtime.setComposer(area.value)
    resize()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !event.isComposing) {
      if (runtime.busy() && !runtime.blocked() && !chrome.overlayOpen()) event.preventDefault()
      return
    }
    if (isNewlineHotkey(event, chrome.sendShortcut())) {
      event.preventDefault()
      insertNewline()
      return
    }
    if (isSendHotkey(event, chrome.sendShortcut())) {
      event.preventDefault()
      void runtime.send()
    }
  }

  return (
    <div class="composer">
      <AttachmentStrip />
      <textarea
        ref={area}
        rows={1}
        disabled={!projects.selectedProject() || runtime.blocked() || !!projects.selectedProject()?.missing}
        placeholder={placeholder()}
        onInput={(event) => runtime.setComposer(event.currentTarget.value)}
        onCompositionStart={() => {
          composing = true
        }}
        onCompositionEnd={onCompositionEnd}
        onKeyDown={onKeyDown}
      />
      <div class="composer-bar">
        <div class="composer-left">
          <ComposerPlus />
          <Show when={chrome.planMode()}>
            <div class="plan-chip">
              <span>Plan</span>
              <button type="button" class="plan-chip-x" aria-label="退出 Plan" onClick={() => chrome.setPlanMode(false)}>
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
          classList={{ stop: runtime.busy() && !hasDraft() }}
          disabled={!canSend()}
          onClick={() => (runtime.busy() && !hasDraft() ? void runtime.abort() : void runtime.send())}
        >
          {runtime.busy() && !hasDraft() ? "停止" : "发送"}
        </button>
      </div>
    </div>
  )
}
