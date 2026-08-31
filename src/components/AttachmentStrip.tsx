import { For, Show } from "solid-js"
import { useApp } from "../store/app"

export function AttachmentStrip() {
  const app = useApp()

  return (
    <Show when={app.state.attachments.length > 0}>
      <div class="attachment-strip">
        <For each={app.state.attachments}>
          {(item) => (
            <div class="attachment-card">
              <button
                type="button"
                class="attachment-remove"
                aria-label={`移除 ${item.filename}`}
                onClick={() => app.removeAttachment(item.id)}
              >
                ×
              </button>
              <div class="attachment-name truncate">{item.filename}</div>
              <div class="attachment-type">{item.label}</div>
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}
