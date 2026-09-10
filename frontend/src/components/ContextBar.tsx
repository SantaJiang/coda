import { Show } from "solid-js"
import { useProjects } from "../store/app"
import { isLocalProject, projectContextLabel } from "../lib/persist"
import { Icon } from "./Icon"

export function ContextBar() {
  const app = useProjects()

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
              {projectContextLabel(project(), app.projects())}
            </span>
          </div>
        )}
      </Show>
      <div class="ctx-pill ctx-branch" title={app.vcsBranch() ? `分支：${app.vcsBranch()}` : undefined}>
        <span class="ctx-icon">
          <Icon name="code-fork" />
        </span>
        <span class="ctx-label truncate">
          {app.selectedProject() && !isLocalProject(app.selectedProject()) ? app.vcsBranch() || "—" : "—"}
        </span>
      </div>
    </div>
  )
}
