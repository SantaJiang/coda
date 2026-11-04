import { Show, createEffect, createMemo, createSignal, on } from "solid-js"
import { KeyedList } from "./KeyedList"
import { useRuntime } from "../store/app"
import { Icon } from "./Icon"

function imageThumb(attachments: { mime: string; preview?: string; url: string; filename: string }[]) {
  const file = attachments.find((entry) => entry.mime.startsWith("image/") && (entry.preview || entry.url.startsWith("data:")))
  if (!file) return ""
  return file.preview || file.url
}

export function QueueDock() {
  const runtime = useRuntime()
  const items = createMemo(() => runtime.queued())
  const [open, setOpen] = createSignal(true)

  createEffect(on(items, (list, prev) => {
    if (list.length > 0 && (prev?.length ?? 0) === 0) setOpen(true)
  }, { defer: true }))

  const preview = (text: string, filenames: string[]) => {
    const line = text.replace(/\s+/g, " ").trim()
    if (line) return line
    if (filenames.length) return filenames.join("、")
    return "(空消息)"
  }

  return (
    <Show when={items().length > 0}>
      <Show
        when={open()}
        fallback={
          <button type="button" class="queue-pill" aria-expanded="false" title="展开队列" onClick={() => setOpen(true)}>
            <span>Queued</span>
            <span class="queue-pill-count">{items().length}</span>
          </button>
        }
      >
        <div class="queue-dock">
          <div class="queue-head">
            <span class="queue-title">{items().length} Queued</span>
            <button type="button" class="queue-collapse" aria-label="收起队列" title="收起" onClick={() => setOpen(false)}>
              <Icon name="minus" />
            </button>
          </div>
          <div class="queue-list">
            <KeyedList each={items()} by={(item) => item.id}>
              {(item) => {
                const text = () => preview(item().text, item().attachments.map((file) => file.filename))
                const thumb = () => imageThumb(item().attachments)
                return (
                  <div class="queue-row">
                    <Show when={thumb()}>
                      <img class="queue-thumb" src={thumb()} alt="" />
                    </Show>
                    <div class="queue-row-text" title={text()}>{text()}</div>
                    <div class="queue-row-actions">
                      <button
                        type="button"
                        class="queue-steer"
                        title="立即发送"
                        aria-label="立即发送"
                        onClick={() => void runtime.sendQueuedNow(item().id)}
                      >
                        Steer
                      </button>
                      <button type="button" class="icon-btn" title="编辑" aria-label="编辑" onClick={() => runtime.editQueued(item().id)}>
                        <Icon name="pencil" />
                      </button>
                      <button type="button" class="icon-btn" title="删除" aria-label="删除" onClick={() => runtime.removeQueued(item().id)}>
                        <Icon name="trash" />
                      </button>
                    </div>
                  </div>
                )
              }}
            </KeyedList>
          </div>
        </div>
      </Show>
    </Show>
  )
}
