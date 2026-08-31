import { Show, createEffect, createSignal, onCleanup } from "solid-js"
import { useApp } from "../store/app"
import * as api from "../lib/api"

function IconFolder() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 5.5v7a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H8L6.7 3.7A1 1 0 0 0 6 3.4H3.5a1 1 0 0 0-1 1.1Z"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linejoin="round"
      />
    </svg>
  )
}

function IconBranch() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <line x1="4" y1="2" x2="4" y2="10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
      <circle cx="12" cy="4" r="2" stroke="currentColor" stroke-width="1.3" />
      <circle cx="4" cy="12" r="2" stroke="currentColor" stroke-width="1.3" />
      <path d="M12 6a6 6 0 0 1-6 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none" />
    </svg>
  )
}

export function ContextBar() {
  const app = useApp()
  const [branch, setBranch] = createSignal("")

  createEffect(() => {
    const project = app.selectedProject()
    if (!project) {
      setBranch("")
      return
    }
    let cancelled = false
    void api
      .getVcs(project.path)
      .then((info) => {
        if (!cancelled) setBranch(info?.branch ?? "")
      })
      .catch(() => {
        if (!cancelled) setBranch("")
      })
    onCleanup(() => {
      cancelled = true
    })
  })

  return (
    <div class="context-bar">
      <Show
        when={app.selectedProject()}
        fallback={
          <button type="button" class="ctx-pill" title="选择项目" onClick={() => void app.addProject()}>
            <span class="ctx-icon">
              <span class="ctx-folder">
                <IconFolder />
              </span>
            </span>
            <span class="ctx-label">选择项目</span>
          </button>
        }
      >
        {(project) => (
          <div class="ctx-pill ctx-project" title={project().path}>
            <span class="ctx-icon">
              <span class="ctx-folder">
                <IconFolder />
              </span>
              <button
                type="button"
                class="ctx-x"
                aria-label="关闭当前项目"
                title="关闭当前项目"
                onClick={() => app.closeProject()}
              >
                ×
              </button>
            </span>
            <span class="ctx-label truncate">{project().name}</span>
          </div>
        )}
      </Show>
      <div class="ctx-pill ctx-branch" title={branch() ? `分支：${branch()}` : undefined}>
        <span class="ctx-icon">
          <IconBranch />
        </span>
        <span class="ctx-label truncate">{app.selectedProject() ? branch() || "—" : "—"}</span>
      </div>
    </div>
  )
}
