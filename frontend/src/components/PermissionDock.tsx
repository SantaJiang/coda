import { For, Show, createSignal } from "solid-js"
import { useRuntime } from "../store/app"

export function PermissionDock() {
  const runtime = useRuntime()
  const pending = () => runtime.pendingPermissions()
  const [submitting, setSubmitting] = createSignal<string>()
  const reply = async (id: string, value: "once" | "always" | "reject") => {
    if (submitting()) return
    setSubmitting(id)
    try { await runtime.replyPermission(id, value) }
    finally { setSubmitting(undefined) }
  }

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
            <button type="button" class="ghost" disabled={Boolean(submitting())} onClick={() => void reply(request().id, "reject")}>
              拒绝
            </button>
            <button type="button" class="secondary" disabled={Boolean(submitting())} onClick={() => void reply(request().id, "always")}>
              始终允许
            </button>
            <button type="button" class="primary" disabled={Boolean(submitting())} onClick={() => void reply(request().id, "once")}>
              允许一次
            </button>
          </div>
        </div>
      )}
    </Show>
  )
}
