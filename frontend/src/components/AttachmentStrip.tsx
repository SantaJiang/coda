import { For, Show } from "solid-js"
import { useRuntime } from "../store/app"
import { Icon } from "./Icon"

export function AttachmentStrip() {
  const app = useRuntime()

  return (
    <Show when={app.attachments().length > 0}>
      <div class="attachment-strip">
        <For each={app.attachments()}>
          {(item) => (
            <div class="attachment-card">
              <button
                type="button"
                class="attachment-remove"
                aria-label={`移除 ${item.filename}`}
                onClick={() => app.removeAttachment(item.id)}
              >
                <Icon name="times" />
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
