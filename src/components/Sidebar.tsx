import { For, Show, createSignal, onCleanup, onMount } from "solid-js"
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
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
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
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 3.6A1.6 1.6 0 0 1 4.6 2h6.8A1.6 1.6 0 0 1 13 3.6v5.3A1.6 1.6 0 0 1 11.4 10.5H7.2L3.8 13.2V3.6Z"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linejoin="round"
      />
    </svg>
  )
}

function IconMore() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="3.5" cy="8" r="1.25" fill="currentColor" />
      <circle cx="8" cy="8" r="1.25" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.25" fill="currentColor" />
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

type CtxMenuState = {
  session: Session
  x: number
  y: number
}

export function Sidebar() {
  const app = useApp()
  const [moreMenuId, setMoreMenuId] = createSignal<string | null>(null)
  const [ctxMenu, setCtxMenu] = createSignal<CtxMenuState | null>(null)
  const [editingId, setEditingId] = createSignal<string | null>(null)
  const [editingValue, setEditingValue] = createSignal("")
  let ctxMenuRoot: HTMLDivElement | undefined

  const toggleMoreMenu = (id: string) => {
    setMoreMenuId((current) => (current === id ? null : id))
    setCtxMenu(null)
  }

  const openSessionMenu = (event: MouseEvent, session: Session) => {
    event.preventDefault()
    event.stopPropagation()
    setEditingId(null)
    setMoreMenuId(null)
    setCtxMenu({ session, x: event.clientX, y: event.clientY })
  }

  const startRename = (session: Session) => {
    setCtxMenu(null)
    setEditingId(session.id)
    setEditingValue(session.title?.trim() ?? "")
  }

  const commitRename = (session: Session) => {
    if (editingId() !== session.id) return
    const title = editingValue().trim()
    setEditingId(null)
    if (title && title !== session.title) void app.renameSession(session, title)
  }

  onMount(() => {
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (ctxMenuRoot && target && ctxMenuRoot.contains(target)) return
      if (target instanceof Element && target.closest(".tree-more")) return
      setCtxMenu(null)
      setMoreMenuId(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCtxMenu(null)
        setMoreMenuId(null)
        setEditingId(null)
      }
    }
    document.addEventListener("pointerdown", onPointer)
    document.addEventListener("keydown", onKey)
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointer)
      document.removeEventListener("keydown", onKey)
    })
  })

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
                  <div class="tree-root">
                    <button
                      type="button"
                      class="tree-root-main"
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
                      <span class="tree-icon">
                        <IconFolder />
                      </span>
                      <span class="truncate" title={project.path}>
                        {project.name}
                      </span>
                    </button>
                    <div class="tree-root-actions" classList={{ open: moreMenuId() === project.id }}>
                      <div class="tree-more">
                        <button
                          type="button"
                          class="icon-btn tree-action"
                          classList={{ open: moreMenuId() === project.id }}
                          title="更多"
                          aria-label="更多"
                          onClick={() => toggleMoreMenu(project.id)}
                        >
                          <IconMore />
                        </button>
                        <Show when={moreMenuId() === project.id}>
                          <div class="context-menu tree-more-menu" role="menu">
                            <button
                              type="button"
                              class="context-menu-item danger"
                              role="menuitem"
                              onClick={() => {
                                app.removeProject(project.id)
                                setMoreMenuId(null)
                              }}
                            >
                              移除项目
                            </button>
                          </div>
                        </Show>
                      </div>
                      <button
                        type="button"
                        class="icon-btn tree-action"
                        title="新建会话"
                        aria-label="新建会话"
                        onClick={() => void app.createSessionInProject(project)}
                      >
                        <IconPlus />
                      </button>
                    </div>
                  </div>
                  <Show when={project.expanded}>
                    <div class="tree-children">
                      <Show when={sessions().length === 0}>
                        <div class="tree-empty nested">暂无会话</div>
                      </Show>
                      <For each={sessions()}>
                        {(session) => (
                          <div
                            class="tree-session"
                            classList={{ active: app.state.selectedSessionId === session.id }}
                          >
                            <Show
                              when={editingId() !== session.id}
                              fallback={
                                <input
                                  ref={(element) => {
                                    if (element) {
                                      element.focus()
                                      element.select()
                                    }
                                  }}
                                  class="tree-rename"
                                  value={editingValue()}
                                  onInput={(event) => setEditingValue(event.currentTarget.value)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      event.preventDefault()
                                      commitRename(session)
                                    } else if (event.key === "Escape") {
                                      event.stopPropagation()
                                      setEditingId(null)
                                    }
                                  }}
                                  onBlur={() => commitRename(session)}
                                />
                              }
                            >
                              <button
                                type="button"
                                class="tree-session-main"
                                onContextMenu={(event) => openSessionMenu(event, session)}
                                onClick={() => void app.selectSession(session)}
                              >
                                <span class="tree-icon">
                                  <IconChat />
                                </span>
                                <span class="truncate">{sessionLabel(session)}</span>
                                <Show when={app.state.status[session.id]?.type === "busy"}>
                                  <span class="pulse-dot" />
                                </Show>
                              </button>
                            </Show>
                          </div>
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

      <Show when={ctxMenu()}>
        {(menu) => (
          <div
            ref={ctxMenuRoot}
            class="context-menu"
            style={{ position: "fixed", left: `${menu().x}px`, top: `${menu().y}px` }}
            role="menu"
          >
            <button
              type="button"
              class="context-menu-item"
              role="menuitem"
              onClick={() => startRename(menu().session)}
            >
              重命名
            </button>
            <button
              type="button"
              class="context-menu-item danger"
              role="menuitem"
              onClick={() => {
                void app.deleteSession(menu().session)
                setCtxMenu(null)
              }}
            >
              删除
            </button>
          </div>
        )}
      </Show>
    </aside>
  )
}
