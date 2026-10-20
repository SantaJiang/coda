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

const SIDEBAR_ICON_PATHS = {
  plus: "M12 5v14M5 12h14",
  compose: "M10 3.5H6.5a3 3 0 0 0-3 3v11a3 3 0 0 0 3 3h11a3 3 0 0 0 3-3V14M16.5 4a2.475 2.475 0 0 1 3.5 3.5l-8.5 8.5-4 .5 .5-4Z",
  folder: "M3 8V6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8Zm0 1h18",
  "folder-open": "M3 18V6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2M5 20h12.5a2 2 0 0 0 1.9-1.4l1.5-5A2 2 0 0 0 19 11H7.5a2 2 0 0 0-1.9 1.4l-2.5 5A1.2 1.2 0 0 0 5 20Z",
  home: "m3 10 9-7 9 7M5 9v11h14V9M9 20v-7h6v7",
  warning: "m10.3 4-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0ZM12 9v4M12 17h.01",
  "ellipsis-h": "M5 12h.01M12 12h.01M19 12h.01",
  pencil: "m16 3 5 5M4 15l-1 6 6-1L21 8a3.5 3.5 0 0 0-5-5Z",
  cog: "M10 3h4l.5 2.5 2 1.2L19 6l2 3.5-2 1.7v2l2 1.7-2 3.5-2.5-.7-2 1.2L14 21h-4l-.5-2.1-2-1.2-2.5.7-2-3.5 2-1.7v-2L3 9.5 5 6l2.5.7 2-1.2ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  times: "m6 6 12 12M6 18 18 6",
} as const

function SidebarIcon(props: { name: keyof typeof SIDEBAR_ICON_PATHS; class?: string }) {
  return (
    <svg
      class={`sidebar-icon ${props.class ?? ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={SIDEBAR_ICON_PATHS[props.name]} />
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

      <div class="tree">
        <Show
          when={projects.projects().length > 0}
          fallback={<div class="tree-empty">点击右上角 + 添加一个代码项目</div>}
        >
          <KeyedList each={projects.projects()} by={(project) => project.id}>
            {(project) => {
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
              const display = () => projectDisplay(project(), projects.projects())
              const subtitle = () => display().hint
              const sessionDot = (sessionID: string) => runtime.sessionDot(sessionID)
              return (
                <div class="tree-project" classList={{ missing: !!project().missing }}>
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
                    <KeyedList each={sessions()} by={(session) => session.id}>
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
