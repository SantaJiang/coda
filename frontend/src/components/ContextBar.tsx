import { Show, createEffect, createSignal, onCleanup } from "solid-js"
import { useApp } from "../store/app"
import * as api from "../lib/api"
import { isLocalProject, projectContextLabel } from "../lib/persist"
import { Icon } from "./Icon"

export function ContextBar() {
  const app = useApp()
  const [branch, setBranch] = createSignal("")

  createEffect(() => {
    const project = app.selectedProject()
    if (!project || isLocalProject(project) || project.missing) {
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
          <div
            class="ctx-pill ctx-project"
            classList={{
              "ctx-local": isLocalProject(project()),
              "ctx-missing": !!project().missing,
            }}
            title={isLocalProject(project()) ? `本机 · ${project().path}` : project().path}
          >
            <span class="ctx-icon">
              <span class="ctx-folder">
                <Icon
                  name={
                    isLocalProject(project()) ? "home" : project().missing ? "warning" : "folder"
                  }
                />
              </span>
              <Show when={!isLocalProject(project())}>
                <button
                  type="button"
                  class="ctx-x"
                  aria-label="关闭当前项目"
                  title="关闭当前项目"
                  onClick={() => app.closeProject()}
                >
                  <Icon name="times" />
                </button>
              </Show>
            </span>
            <span class="ctx-label truncate">
              {projectContextLabel(project(), app.state.projects)}
            </span>
          </div>
        )}
      </Show>
      <div class="ctx-pill ctx-branch" title={branch() ? `分支：${branch()}` : undefined}>
        <span class="ctx-icon">
          <Icon name="code-fork" />
        </span>
        <span class="ctx-label truncate">
          {app.selectedProject() && !isLocalProject(app.selectedProject()) ? branch() || "—" : "—"}
        </span>
      </div>
    </div>
  )
}
