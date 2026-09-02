import { Show, createEffect, createSignal, onCleanup } from "solid-js"
import { useApp } from "../store/app"
import * as api from "../lib/api"
import { Icon } from "./Icon"

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
                <Icon name="folder" />
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
                <Icon name="folder" />
              </span>
              <button
                type="button"
                class="ctx-x"
                aria-label="关闭当前项目"
                title="关闭当前项目"
                onClick={() => app.closeProject()}
              >
                <Icon name="times" />
              </button>
            </span>
            <span class="ctx-label truncate">{project().name}</span>
          </div>
        )}
      </Show>
      <div class="ctx-pill ctx-branch" title={branch() ? `分支：${branch()}` : undefined}>
        <span class="ctx-icon">
          <Icon name="code-fork" />
        </span>
        <span class="ctx-label truncate">{app.selectedProject() ? branch() || "—" : "—"}</span>
      </div>
    </div>
  )
}
