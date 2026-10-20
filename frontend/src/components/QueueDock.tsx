import { Show, createMemo } from "solid-js"
import { KeyedList } from "./KeyedList"
import { useRuntime } from "../store/app"
import { Icon } from "./Icon"

export function QueueDock() {
  const runtime = useRuntime()
  const items = createMemo(() => runtime.queued())

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
          <KeyedList each={items()} by={(item) => item.id}>
            {(item) => (
              <div class="queue-row">
                <div class="queue-row-text" title={preview(item().text, item().attachments.map((file) => file.filename))}>
                  {preview(
                    item().text,
                    item().attachments.map((file) => file.filename),
                  )}
                </div>
                <div class="queue-row-actions">
                  <button
                    type="button"
                    class="icon-btn"
                    title="立即发送"
                    aria-label="立即发送"
                    onClick={() => void runtime.sendQueuedNow(item().id)}
                  >
                    <Icon name="paper-plane" />
                  </button>
                  <button
                    type="button"
                    class="icon-btn"
                    title="编辑"
                    aria-label="编辑"
                    onClick={() => runtime.editQueued(item().id)}
                  >
                    <Icon name="pencil" />
                  </button>
                  <button
                    type="button"
                    class="icon-btn"
                    title="删除"
                    aria-label="删除"
                    onClick={() => runtime.removeQueued(item().id)}
                  >
                    <Icon name="trash" />
                  </button>
                </div>
              </div>
            )}
          </KeyedList>
        </div>
      </div>
    </Show>
  )
}
