import { For, Show, createMemo, createSignal } from "solid-js"
import type { ChangedFile } from "../lib/activity"

function fileKind(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? ""
  if (ext === "ts") return { label: "TS", tone: "ts" }
  if (ext === "tsx") return { label: "TX", tone: "tsx" }
  if (ext === "js" || ext === "mjs" || ext === "cjs") return { label: "JS", tone: "js" }
  if (ext === "jsx") return { label: "JX", tone: "tsx" }
  if (ext === "css" || ext === "scss") return { label: "#", tone: "css" }
  if (ext === "json") return { label: "{}", tone: "json" }
  if (ext === "md") return { label: "M", tone: "md" }
  if (ext === "rs") return { label: "RS", tone: "rs" }
  return { label: "F", tone: "file" }
}

function FileGlyph(props: { name: string }) {
  const kind = createMemo(() => fileKind(props.name))
  return (
    <span class="changed-file-icon" data-kind={kind().tone} aria-hidden="true">
      {kind().label}
    </span>
  )
}

export function ChangedFiles(props: { files: ChangedFile[] }) {
  const [review, setReview] = createSignal(false)
  const [openPath, setOpenPath] = createSignal<string | null>(null)
  const title = createMemo(() => {
    const n = props.files.length
    return n === 1 ? "1 File Changed" : `${n} Files Changed`
  })

  const toggleFile = (path: string) => {
    setOpenPath((current) => (current === path ? null : path))
  }

  return (
    <Show when={props.files.length > 0}>
      <section class="changed-files">
        <header class="changed-files-head">
          <span class="changed-files-title">{title()}</span>
          <button type="button" class="changed-files-review" onClick={() => setReview((value) => !value)}>
            {review() ? "Hide" : "Review"}
          </button>
        </header>
        <div class="changed-files-list">
          <For each={props.files}>
            {(file) => (
              <div class="changed-file" classList={{ open: review() || openPath() === file.path }}>
                <button
                  type="button"
                  class="changed-file-row"
                  title={file.path}
                  onClick={() => toggleFile(file.path)}
                >
                  <FileGlyph name={file.name} />
                  <span class="changed-file-name">{file.name}</span>
                  <span class="work-diff">
                    <Show when={file.added > 0}>
                      <span class="work-diff-add">+{file.added}</span>
                    </Show>
                    <Show when={file.removed > 0}>
                      <span class="work-diff-del">-{file.removed}</span>
                    </Show>
                  </span>
                </button>
                <Show when={(review() || openPath() === file.path) && file.patch}>
                  <pre class="changed-file-patch">{file.patch}</pre>
                </Show>
              </div>
            )}
          </For>
        </div>
      </section>
    </Show>
  )
}
