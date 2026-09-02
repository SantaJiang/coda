import { For, Show } from "solid-js"
import { useApp } from "../store/app"

export function PermissionDock() {
  const app = useApp()
  const sessionId = () => app.state.selectedSessionId
  const pending = () =>
    Object.values(app.state.permissions).filter((item) => item && item.sessionID === sessionId())

  return (
    <Show when={pending()[0]}>
      {(request) => (
        <div class="dock dock-permission">
          <div class="dock-title">需要授权 · {request().permission}</div>
          <Show when={request().patterns?.length}>
            <div class="dock-patterns">
              <For each={request().patterns}>{(pattern) => <code>{pattern}</code>}</For>
            </div>
          </Show>
          <div class="dock-actions">
            <button type="button" class="ghost" onClick={() => void app.replyPermission(request().id, "reject")}>
              拒绝
            </button>
            <button type="button" class="secondary" onClick={() => void app.replyPermission(request().id, "always")}>
              始终允许
            </button>
            <button type="button" class="primary" onClick={() => void app.replyPermission(request().id, "once")}>
              允许一次
            </button>
          </div>
        </div>
      )}
    </Show>
  )
}
