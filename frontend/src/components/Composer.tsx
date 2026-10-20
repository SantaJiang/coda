import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { isTauri } from "../lib/platform-detect"
import { attachmentModelError } from "../lib/model-input"
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
  let root!: HTMLDivElement
  const [dragging, setDragging] = createSignal(false)
  const attachmentError = () => attachmentModelError(runtime.attachments(), models.selectedModel()?.input, models.selectedModel()?.adapter)

  const placeholder = () => {
    if (!projects.selectedProject()) return "先添加一个项目文件夹"
    if (projects.selectedProject()?.missing) return "先重新定位项目文件夹"
    if (!models.selectedModel()) return "先配置一个模型"
    if (runtime.blocked()) return "请先处理权限或提问"
    if (runtime.stopping()) return "正在停止…"
    if (runtime.busy()) return "正在回复，继续发送会加入队列…"
    if (isLocalProject(projects.selectedProject())) return "不问具体项目也可以，发给 Agent 一条消息"
    return "发给 Agent 一条消息"
  }

  const hasDraft = () => !!runtime.composer().trim() || runtime.attachments().length > 0

  const canSend = () =>
    !!projects.selectedProject() &&
    !projects.selectedProject()?.missing &&
    !runtime.blocked() &&
    !runtime.stopping() &&
    ((runtime.busy() && !hasDraft()) ||
      (!runtime.attachmentsLoading() && !attachmentError() && hasDraft()))

  const resize = () => {
    if (!area) return
    if (!area.value) {
      area.style.height = ""
      return
    }
    area.style.height = "auto"
    area.style.height = `${Math.min(area.scrollHeight, COMPOSER_MAX_HEIGHT)}px`
  }

  // textarea 不用 value 绑定做受控组件：Solid 每次输入都回写 node.value 会
  // 重置光标并打断 IME 组合，导致 "" 自动配对、智能引号变成 ”” 之类的乱码。
  // 只有外部改动（发送清空、恢复草稿等）且不在组合输入中时才回写 DOM。
  createEffect(() => {
    const next = runtime.composer()
    if (area && !composing && area.value !== next) area.value = next
    queueMicrotask(() => { if (area?.isConnected) resize() })
  })

  const onCompositionEnd = () => {
    composing = false
    if (area) runtime.setComposer(area.value)
  }

  const stopIfBusy = () => {
    if (!runtime.busy() || runtime.stopping() || chrome.overlayOpen()) return false
    void runtime.abort()
    return true
  }

  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      if (target?.closest(".dialog-overlay, .context-menu, .model-menu")) return
      if (target?.closest("input, textarea, select") && !target.closest(".composer")) return
      if (stopIfBusy()) event.preventDefault()
    }
    document.addEventListener("keydown", onKey)
    onCleanup(() => document.removeEventListener("keydown", onKey))
    // A terminal/plan sidebar changes line wrapping even when the draft does
    // not change. Refit before paint so text does not clip then jump on typing.
    if (typeof ResizeObserver !== "undefined") {
      let width = root.clientWidth
      const observer = new ResizeObserver(() => {
        if (root.clientWidth === width) return
        width = root.clientWidth
        resize()
      })
      observer.observe(root)
      onCleanup(() => observer.disconnect())
    }
    if (isTauri()) {
      let disposed = false
      let unlisten: (() => void) | undefined
      void import("@tauri-apps/api/webview").then(({ getCurrentWebview }) => getCurrentWebview().onDragDropEvent(({ payload }) => {
        if (payload.type === "leave") { setDragging(false); return }
        const rect = root.getBoundingClientRect()
        const x = payload.position.x / window.devicePixelRatio, y = payload.position.y / window.devicePixelRatio
        const inside = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
        setDragging(payload.type !== "drop" && inside)
        if (payload.type === "drop" && inside) void runtime.importAttachments({ paths: payload.paths })
      })).then((off) => { if (disposed) off(); else unlisten = off }).catch(() => undefined)
      onCleanup(() => { disposed = true; unlisten?.() })
    }
  })

  const onPaste = async (event: ClipboardEvent & { currentTarget: HTMLTextAreaElement }) => {
    const data = event.clipboardData
    if (!data) return
    const files = Array.from(data.files)
    if (!files.length) for (const item of Array.from(data.items)) {
      if (item.kind !== "file") continue
      const file = item.getAsFile()
      if (file) files.push(file)
    }
    if (files.length) {
      event.preventDefault()
      await runtime.importAttachments({ files })
      return
    }
    if (!isTauri()) return
    // WebKit can expose no File objects for a native image or Finder file copy.
    event.preventDefault()
    const node = event.currentTarget
    const text = data.getData("text/plain")
    const value = node.value, start = node.selectionStart, end = node.selectionEnd
    const importing = runtime.importAttachments({ clipboard: true, includeImage: !text })
    const sessionID = projects.selectedSessionId()
    const consumed = await importing
    if (consumed || !text || area !== node || projects.selectedSessionId() !== sessionID) return
    if (node.value === value) node.setSelectionRange(start, end)
    const inserted = document.activeElement === node && typeof document.execCommand === "function" && document.execCommand("insertText", false, text)
    if (!inserted) node.setRangeText(text, node.selectionStart, node.selectionEnd, "end")
    runtime.setComposer(node.value)
    resize()
  }

  const insertNewline = () => {
    if (!area) return
    area.focus({ preventScroll: true })
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
    <div class="composer" ref={root} classList={{ "drag-over": dragging() }}
      onDragOver={(event) => { if (event.dataTransfer?.types.includes("Files")) { event.preventDefault(); setDragging(true) } }}
      onDragLeave={(event) => { if (!root.contains(event.relatedTarget as Node | null)) setDragging(false) }}
      onDrop={(event) => {
        setDragging(false)
        const files = Array.from(event.dataTransfer?.files ?? [])
        if (!files.length) return
        event.preventDefault()
        void runtime.importAttachments({ files })
      }}>
      <AttachmentStrip />
      <Show when={runtime.attachmentsLoading()}><div class="attachment-notice" role="status">正在读取附件…</div></Show>
      <Show when={attachmentError()}><div class="attachment-notice warning" role="status">{attachmentError()} <button type="button" class="text-btn" onClick={() => models.openModelSettings()}>配置模型</button></div></Show>
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
        onPaste={onPaste}
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
