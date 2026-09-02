import { For, Show, createMemo } from "solid-js"
import { useApp } from "../store/app"
import { Icon } from "./Icon"

export function QueueDock() {
  const app = useApp()
  const items = createMemo(() => {
    const id = app.state.selectedSessionId
    if (!id) return []
    return app.state.queuedBySession[id] ?? []
  })

  const preview = (text: string, filenames: string[]) => {
    const line = text.replace(/\s+/g, " ").trim()
    if (line) return line
    if (filenames.length) return filenames.join("、")
    return "(空消息)"
  }

  return (
    <Show when={items().length > 0}>
      <div class="queue-dock">
        <div class="queue-title">{items().length} Queued Message</div>
        <div class="queue-list">
          <For each={items()}>
            {(item) => (
              <div class="queue-row">
                <div class="queue-row-text" title={preview(item.text, item.attachments.map((file) => file.filename))}>
                  {preview(
                    item.text,
                    item.attachments.map((file) => file.filename),
                  )}
                </div>
                <div class="queue-row-actions">
                  <button
                    type="button"
                    class="icon-btn"
                    title="立即发送"
                    aria-label="立即发送"
                    onClick={() => void app.sendQueuedNow(item.id)}
                  >
                    <Icon name="paper-plane" />
                  </button>
                  <button
                    type="button"
                    class="icon-btn"
                    title="编辑"
                    aria-label="编辑"
                    onClick={() => app.editQueued(item.id)}
                  >
                    <Icon name="pencil" />
                  </button>
                  <button
                    type="button"
                    class="icon-btn"
                    title="删除"
                    aria-label="删除"
                    onClick={() => app.removeQueued(item.id)}
                  >
                    <Icon name="trash" />
                  </button>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  )
}
