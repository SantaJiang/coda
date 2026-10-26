import { Show, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { KeyedList } from "./KeyedList"
import { isLocalProject, projectDisplay } from "../lib/persist"
import { isLocalDraft } from "../lib/draft-session"
import { formatSessionTitle } from "../lib/session-label"
import { isMacPlatform } from "../lib/settings"
import { type SessionDot } from "../lib/session-status"
import { useChrome, useProjects, useRuntime } from "../store/app"
import type { Project, Session } from "../lib/types"
import { ChromeDrag } from "./WindowChrome"

const COLLAPSE_MS = 200
const COLLAPSE_EASE = "cubic-bezier(0.16, 1, 0.3, 1)"
const SESSION_PREVIEW_COUNT = 5

// Draw at the rendered size: half-pixel centers keep 1px strokes aligned
// with the pixel grid instead of scaling 24px geometry down to 16px.
const SIDEBAR_ICON_PATHS = {
  plus: "M8.5 3.5v10M3.5 8.5h10",
  compose: "M7.5 3.5H5a2.5 2.5 0 0 0-2.5 2.5v5a2.5 2.5 0 0 0 2.5 2.5h6a2.5 2.5 0 0 0 2.5-2.5V8.5",
  folder: "M2.5 6.5v-2a1 1 0 0 1 1-1H6l1.5 2h5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-6h11",
  "folder-open": "M2.5 11.5v-7a1 1 0 0 1 1-1H6l1.5 2h5a1 1 0 0 1 1 1M3.5 13.5h8.25a1 1 0 0 0 .95-.68l1.65-5A1 1 0 0 0 13.4 6.5H5.75a1 1 0 0 0-.95.68l-2.25 5a1 1 0 0 0 .95 1.32Z",
  home: "m2 7 6-5 6 5M3.5 6v7.5h9V6M6.5 13.5v-5h3v5",
  warning: "m7.13 2.5-6 10.5a1 1 0 0 0 .87 1.5h12a1 1 0 0 0 .87-1.5l-6-10.5a1 1 0 0 0-1.74 0ZM8 6v3.5M8 12h.01",
  "ellipsis-h": "M3.5 8.5h.01M8.5 8.5h.01M13.5 8.5h.01",
  pencil: "m10.5 2.5 3 3M3 10l-.5 3.5L6 13l7.5-7.5a2.12 2.12 0 0 0-3-3Z",
  cog: "M6.5 1.5h3l.5 2 1.5 1 2-.5L15 6.5l-1.5 1v1l1.5 1-1.5 2.5-2-.5-1.5 1-.5 2h-3l-.5-2-1.5-1-2 .5L1 9.5l1.5-1v-1L1 6.5 2.5 4l2 .5 1.5-1ZM10.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z",
  times: "m4 4 8 8M4 12l8-8",
} as const

function SidebarIcon(props: { name: keyof typeof SIDEBAR_ICON_PATHS; class?: string }) {
  return (
    <svg
      class={`sidebar-icon ${props.class ?? ""}`}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="1"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={SIDEBAR_ICON_PATHS[props.name]} />
      <Show when={props.name === "compose"}>
        {/* A solid nib stays legible at 16px without two antialiased outlines merging. */}
        <path d="m6 8 5.5-5.5a.707.707 0 0 1 1 1L7 9l-1.5.5Z" fill="currentColor" stroke="none" />
      </Show>
    </svg>
  )
}

function TreeCollapse(props: { open: boolean; children: JSX.Element }) {
  let el: HTMLDivElement | undefined
  let running: Animation | undefined

  const snap = (open: boolean) => {
    if (!el) return
    el.style.height = open ? "auto" : "0px"
    el.style.overflow = "hidden"
  }

  const play = (open: boolean) => {
    const node = el
    if (!node) return
    const from = node.getBoundingClientRect().height
    running?.cancel()
    running = undefined

    const to = open ? node.scrollHeight : 0
    if (Math.abs(from - to) < 0.5) {
      snap(open)
      return
    }

    node.style.overflow = "hidden"
    node.style.height = `${from}px`
    running = node.animate([{ height: `${from}px` }, { height: `${to}px` }], {
      duration: COLLAPSE_MS,
      easing: COLLAPSE_EASE,
      fill: "forwards",
    })
    running.onfinish = () => {
      const anim = running
      snap(open)
      anim?.cancel()
      running = undefined
    }
  }

  onMount(() => snap(props.open))

  createEffect((prev?: boolean) => {
    const open = props.open
    if (prev === undefined) return open
    if (prev !== open) play(open)
    return open
  })

  onCleanup(() => running?.cancel())

  return (
    <div ref={el} class="tree-collapse" classList={{ open: props.open }} inert={!props.open}>
      <div class="tree-children">{props.children}</div>
    </div>
  )
}

function sessionLabel(session: Session) {
  if (isLocalDraft(session)) return session.title?.trim() || "新会话"
  return formatSessionTitle(session.title)
}

function sessionDotTitle(kind: SessionDot) {
  if (kind === "wait") return "等待你确认权限或回答问题"
  if (kind === "error") return "该会话执行出错"
  if (kind === "busy") return "正在运行"
  return "该会话已执行完毕，点击查看结果"
}

type CtxMenuState = {
  session: Session
  x: number
  y: number
}

type ConfirmTarget = { kind: "project"; project: Project } | { kind: "session"; session: Session }

export function Sidebar() {
  const projects = useProjects()
  const runtime = useRuntime()
  const chrome = useChrome()
  const [moreMenuId, setMoreMenuId] = createSignal<string | null>(null)
  const [ctxMenu, setCtxMenu] = createSignal<CtxMenuState | null>(null)
  const [editingId, setEditingId] = createSignal<string | null>(null)
  const [editingValue, setEditingValue] = createSignal("")
  const [confirmTarget, setConfirmTarget] = createSignal<ConfirmTarget | null>(null)
  let ctxMenuRoot: HTMLDivElement | undefined

  const toggleMoreMenu = (id: string) => {
    setMoreMenuId((current) => (current === id ? null : id))
    setCtxMenu(null)
  }

  const runConfirm = () => {
    const target = confirmTarget()
    if (!target) return
    if (target.kind === "project") {
      projects.removeProject(target.project.id)
      setMoreMenuId(null)
    } else {
      void projects.deleteSession(target.session)
      setCtxMenu(null)
    }
    setConfirmTarget(null)
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
    if (title && title !== session.title) void projects.renameSession(session, title)
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
        setConfirmTarget(null)
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
      <ChromeDrag class="sidebar-chrome">
        {isMacPlatform() ? <div class="sidebar-lights" /> : null}
      </ChromeDrag>
      <button
        class="new-session"
        type="button"
        onClick={() => projects.startDraft()}
        disabled={!projects.selectedProject() || projects.selectedProject()?.missing}
      >
        <SidebarIcon name="compose" />
        <span>新会话</span>
      </button>

      <div class="projects-head">
        <span>项目</span>
        <button class="icon-btn" type="button" title="添加项目文件夹" onClick={() => void projects.addProject()}>
          <SidebarIcon name="plus" />
        </button>
      </div>

      <div
        class="tree"
        onScroll={(event) => {
          const tree = event.currentTarget
          tree.style.setProperty("--tree-fade-size", `${Math.min(12, Math.max(0, tree.scrollTop))}px`)
        }}
      >
        <Show
          when={projects.projects().length > 0}
          fallback={<div class="tree-empty">点击右上角 + 添加一个代码项目</div>}
        >
          <KeyedList each={projects.projects()} by={(project) => project.id}>
            {(project) => {
              const [showAllSessions, setShowAllSessions] = createSignal(false)
              const sessions = createMemo((previous: Session[] = []) => {
                const sorted = [...projects.sessionsFor(project().path)].sort(
                  (a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0),
                )
                if (!editingId()) return sorted
                // Moving a focused input in the DOM can blur it and commit a
                // partial rename. Defer recency reordering until editing ends.
                const order = new Map(previous.map((session, index) => [session.id, index]))
                return sorted.sort((a, b) => (order.get(a.id) ?? previous.length) - (order.get(b.id) ?? previous.length))
              })
              // Keep the active conversation visible, including restored older
              // sessions and sessions whose recency changes while renaming.
              const visibleSessionCount = createMemo(() => {
                if (showAllSessions()) return sessions().length
                const selectedIndex = sessions().findIndex((session) => session.id === projects.selectedSessionId())
                const editingIndex = sessions().findIndex((session) => session.id === editingId())
                return Math.max(SESSION_PREVIEW_COUNT, selectedIndex + 1, editingIndex + 1)
              })
              const visibleSessions = createMemo(() => sessions().slice(0, visibleSessionCount()))
              const display = () => projectDisplay(project(), projects.projects())
              const subtitle = () => display().hint
              const sessionDot = (sessionID: string) => runtime.sessionDot(sessionID)
              return (
                <div class="tree-project" classList={{ missing: !!project().missing, expanded: project().expanded }}>
                  <div class="tree-root" classList={{ active: projects.selectedProject()?.id === project().id && (!project().expanded || !projects.selectedSessionId()) }}>
                    <button
                      type="button"
                      class="tree-root-main"
                      aria-expanded={project().expanded}
                      title={project().path}
                      onClick={() => projects.toggleProject(project().id)}
                    >
                      <span class="tree-icon">
                        <SidebarIcon
                          class="tree-folder"
                          name={
                            isLocalProject(project()) ? "home" : project().missing ? "warning" : project().expanded ? "folder-open" : "folder"
                          }
                        />
                      </span>
                      <span class="tree-name-wrap">
                        <span class="truncate">{display().name}</span>
                        <Show when={subtitle()}>
                          {(hint) => <span class="tree-path-hint truncate">{hint()}</span>}
                        </Show>
                      </span>
                    </button>
                    <div
                      class="tree-root-actions"
                      classList={{ open: moreMenuId() === project().id, pinned: !!project().missing }}
                    >
                      <Show when={!isLocalProject(project())}>
                        <div class="tree-more">
                          <button
                            type="button"
                            class="icon-btn tree-action"
                            classList={{ open: moreMenuId() === project().id }}
                            title="更多"
                            aria-label="更多"
                            onClick={() => toggleMoreMenu(project().id)}
                          >
                            <SidebarIcon name="ellipsis-h" />
                          </button>
                          <Show when={moreMenuId() === project().id}>
                            <div class="context-menu tree-more-menu" role="menu">
                              <button
                                type="button"
                                class="context-menu-item"
                                role="menuitem"
                                onClick={() => {
                                  setMoreMenuId(null)
                                  void projects.relocateProject(project().id)
                                }}
                              >
                                重新定位
                              </button>
                              <button
                                type="button"
                                class="context-menu-item danger"
                                role="menuitem"
                                onClick={() => {
                                  setMoreMenuId(null)
                                  setConfirmTarget({ kind: "project", project: project() })
                                }}
                              >
                                移除项目
                              </button>
                            </div>
                          </Show>
                        </div>
                      </Show>
                      <button
                        type="button"
                        class="icon-btn tree-action"
                        title="新建会话"
                        aria-label="新建会话"
                        disabled={!!project().missing}
                        onClick={() => {
                          projects.selectProject(project().id)
                          projects.startDraft()
                        }}
                      >
                        <SidebarIcon name="plus" />
                      </button>
                    </div>
                  </div>
                  <TreeCollapse open={project().expanded}>
                    <Show when={sessions().length === 0}>
                      <div class="tree-empty nested">暂无会话</div>
                    </Show>
                    <KeyedList each={visibleSessions()} by={(session) => session.id}>
                      {(session) => (
                        <div
                          class="tree-session"
                          classList={{
                            active: projects.selectedSessionId() === session().id,
                            draft: isLocalDraft(session()),
                          }}
                        >
                          <Show
                            when={editingId() !== session().id}
                            fallback={
                              <input
                                ref={(element) => {
                                  element.value = editingValue()
                                  queueMicrotask(() => { if (element.isConnected) { element.focus({ preventScroll: true }); element.select() } })
                                }}
                                class="tree-rename"
                                onInput={(event) => setEditingValue(event.currentTarget.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault()
                                    commitRename(session())
                                  } else if (event.key === "Escape") {
                                    event.stopPropagation()
                                    setEditingId(null)
                                  }
                                }}
                                onBlur={() => commitRename(session())}
                              />
                            }
                          >
                            <button
                              type="button"
                              class="tree-session-main"
                              title={sessionLabel(session())}
                              onContextMenu={(event) => openSessionMenu(event, session())}
                              onClick={() => void projects.selectSession(session())}
                            >
                              <Show when={isLocalDraft(session())}>
                                <span class="tree-draft-icon" title="未提交的草稿">
                                  <SidebarIcon name="pencil" />
                                </span>
                              </Show>
                              <span class="truncate">{sessionLabel(session())}</span>
                              <Show when={sessionDot(session().id)}>
                                {(kind) => (
                                  <span
                                    class="session-dot"
                                    classList={{
                                      wait: kind() === "wait",
                                      error: kind() === "error",
                                      busy: kind() === "busy",
                                      unread: kind() === "unread",
                                    }}
                                    title={sessionDotTitle(kind())}
                                  />
                                )}
                              </Show>
                            </button>
                          </Show>
                        </div>
                      )}
                    </KeyedList>
                    <Show when={sessions().length > SESSION_PREVIEW_COUNT && (showAllSessions() || visibleSessionCount() < sessions().length)}>
                      <button
                        type="button"
                        class="tree-show-more"
                        aria-expanded={showAllSessions()}
                        onClick={() => setShowAllSessions((value) => !value)}
                      >
                        {showAllSessions() ? "收起显示" : "展开显示"}
                      </button>
                    </Show>
                  </TreeCollapse>
                </div>
              )
            }}
          </KeyedList>
        </Show>
      </div>

      <div class="sidebar-foot">
        <span
          class="status-pill"
          classList={{
            ok: projects.connection() === "connected",
            bad: projects.connection() === "disconnected",
          }}
        >
          {projects.connection() === "connected"
            ? "后端已连接"
            : projects.connection() === "connecting"
              ? "正在连接"
              : "正在重连…"}
        </span>
        <button class="icon-btn" type="button" title="设置" aria-label="设置" onClick={() => chrome.openSettings()}>
          <SidebarIcon name="cog" />
        </button>
      </div>

      <Show when={ctxMenu()}>
        {(menu) => (
          <div
            ref={ctxMenuRoot}
            class="context-menu"
            style={{ position: "fixed", left: `${menu().x}px`, top: `${menu().y}px` }}
            role="menu"
          >
            <Show when={!isLocalDraft(menu().session)}>
              <button
                type="button"
                class="context-menu-item"
                role="menuitem"
                onClick={() => startRename(menu().session)}
              >
                重命名
              </button>
            </Show>
            <button
              type="button"
              class="context-menu-item danger"
              role="menuitem"
              onClick={() => {
                const session = menu().session
                setCtxMenu(null)
                setConfirmTarget({ kind: "session", session })
              }}
            >
              删除
            </button>
          </div>
        )}
      </Show>

      <Show when={confirmTarget()}>
        {(target) => {
          const current = target()
          return (
            <div
              class="dialog-overlay"
              onKeyDown={(event) => {
                if (event.key === "Escape") setConfirmTarget(null)
              }}
            >
              <div class="dialog confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
                <header class="dialog-head">
                  <h2 id="confirm-title">{current.kind === "project" ? "移除项目" : "删除会话"}</h2>
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label="关闭"
                    onClick={() => setConfirmTarget(null)}
                  >
                    <SidebarIcon name="times" />
                  </button>
                </header>
                <p class="dialog-hint">
                  {current.kind === "project" ? (
                    <>确定将「{current.project.name}」从项目列表中移除？不会删除本地文件夹。</>
                  ) : (
                    <>确定删除会话「{sessionLabel(current.session)}」？删除后不可恢复。</>
                  )}
                </p>
                <div class="dialog-actions">
                  <button type="button" class="ghost-btn" autofocus onClick={() => setConfirmTarget(null)}>
                    取消
                  </button>
                  <button type="button" class="send-btn stop" onClick={runConfirm}>
                    {current.kind === "project" ? "移除" : "删除"}
                  </button>
                </div>
              </div>
            </div>
          )
        }}
      </Show>
    </aside>
  )
}
