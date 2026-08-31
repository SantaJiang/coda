import { For, Show } from "solid-js"
import { useApp } from "../store/app"
import type { Session } from "../lib/types"

function IconPlus() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  )
}

function IconFolder() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 5.5v7a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H8L6.7 3.7A1 1 0 0 0 6 3.4H3.5a1 1 0 0 0-1 1.1Z"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linejoin="round"
      />
    </svg>
  )
}

function IconChat() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 4.2A1.2 1.2 0 0 1 4.2 3h7.6A1.2 1.2 0 0 1 13 4.2v5.1A1.2 1.2 0 0 1 11.8 10.5H7l-3.2 2.3V4.2Z"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linejoin="round"
      />
    </svg>
  )
}

function IconChevron(props: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      class="tree-chevron"
      style={{ transform: props.open ? "rotate(90deg)" : "rotate(0deg)" }}
      aria-hidden="true"
    >
      <path d="M4 2.5 8 6 4 9.5" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" />
    </svg>
  )
}

function sessionLabel(session: Session) {
  const title = session.title?.trim() || "未命名会话"
  return title.replace(/^New session.*$/i, "新会话")
}

export function Sidebar() {
  const app = useApp()

  return (
    <aside class="sidebar">
      <button class="new-session" type="button" onClick={() => app.startDraft()} disabled={!app.selectedProject()}>
        <IconPlus />
        <span>新会话</span>
      </button>

      <div class="projects-head">
        <span>项目</span>
        <button class="icon-btn" type="button" title="添加项目文件夹" onClick={() => void app.addProject()}>
          <IconPlus />
        </button>
      </div>

      <div class="tree">
        <Show
          when={app.state.projects.length > 0}
          fallback={<div class="tree-empty">点击右上角 + 添加一个本地文件夹</div>}
        >
          <For each={app.state.projects}>
            {(project) => {
              const sessions = () =>
                [...(app.state.sessionsByProject[project.path] ?? [])].sort(
                  (a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0),
                )
              return (
                <div class="tree-project">
                  <button
                    type="button"
                    class="tree-root"
                    onClick={() => app.selectProject(project.id)}
                  >
                    <span
                      class="chevron-hit"
                      onClick={(event) => {
                        event.stopPropagation()
                        app.toggleProject(project.id)
                      }}
                    >
                      <IconChevron open={project.expanded} />
                    </span>
                    <IconFolder />
                    <span class="truncate" title={project.path}>
                      {project.name}
                    </span>
                  </button>
                  <Show when={project.expanded}>
                    <div class="tree-children">
                      <Show when={sessions().length === 0}>
                        <div class="tree-empty nested">暂无会话</div>
                      </Show>
                      <For each={sessions()}>
                        {(session) => (
                          <button
                            type="button"
                            class="tree-session"
                            classList={{ active: app.state.selectedSessionId === session.id }}
                            onClick={() => void app.selectSession(session)}
                          >
                            <IconChat />
                            <span class="truncate">{sessionLabel(session)}</span>
                            <Show when={app.state.status[session.id]?.type === "busy"}>
                              <span class="pulse-dot" />
                            </Show>
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              )
            }}
          </For>
        </Show>
      </div>

      <div class="sidebar-foot">
        <span
          class="status-pill"
          classList={{
            ok: app.state.connection === "connected",
            bad: app.state.connection === "disconnected",
          }}
        >
          {app.state.connection === "connected"
            ? "后端已连接"
            : app.state.connection === "connecting"
              ? "正在连接"
              : "后端未连接"}
        </span>
      </div>
    </aside>
  )
}
