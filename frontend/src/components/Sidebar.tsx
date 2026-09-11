import { For, Index, Show, createEffect, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { isLocalProject, projectDisplay } from "../lib/persist"
import { formatSessionTitle } from "../lib/session-label"
import { isMacPlatform } from "../lib/settings"
import { type SessionDot } from "../lib/session-status"
import { useChrome, useProjects, useRuntime } from "../store/app"
import type { Project, Session } from "../lib/types"
import { Icon } from "./Icon"
import { ChromeDrag } from "./WindowChrome"

const COLLAPSE_MS = 200
const COLLAPSE_EASE = "cubic-bezier(0.16, 1, 0.3, 1)"

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
        {isMacPlatform() ? <div class="sidebar-lights" data-tauri-drag-region="" /> : null}
      </ChromeDrag>
      <button
        class="new-session"
        type="button"
        onClick={() => projects.startDraft()}
        disabled={!projects.selectedProject() || projects.selectedProject()?.missing}
      >
        <Icon name="plus" />
        <span>新会话</span>
      </button>

      <div class="projects-head">
        <span>项目</span>
        <button class="icon-btn" type="button" title="添加项目文件夹" onClick={() => void projects.addProject()}>
          <Icon name="plus" />
        </button>
      </div>

      <div class="tree">
        <Show
          when={projects.projects().length > 0}
          fallback={<div class="tree-empty">点击右上角 + 添加一个代码项目</div>}
        >
          <Index each={projects.projects()}>
            {(project) => {
              const sessions = () =>
                [...projects.sessionsFor(project().path)].sort(
                  (a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0),
                )
              const display = () => projectDisplay(project(), projects.projects())
              const subtitle = () => display().hint
              const sessionDot = (sessionID: string) => runtime.sessionDot(sessionID)
              return (
                <div class="tree-project" classList={{ missing: !!project().missing }}>
                  <div class="tree-root">
                    <button
                      type="button"
                      class="tree-root-main"
                      aria-expanded={project().expanded}
                      title={project().path}
                      onClick={() => projects.toggleProject(project().id)}
                    >
                      <span class="chevron-hit" classList={{ open: project().expanded }}>
                        <Icon name="chevron-right" class="tree-chevron" />
                      </span>
                      <span class="tree-icon">
                        <Icon
                          name={
                            isLocalProject(project()) ? "home" : project().missing ? "warning" : "folder"
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
                            <Icon name="ellipsis-h" />
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
                        <Icon name="plus" />
                      </button>
                    </div>
                  </div>
                  <TreeCollapse open={project().expanded}>
                    <Show when={sessions().length === 0}>
                      <div class="tree-empty nested">暂无会话</div>
                    </Show>
                    <For each={sessions()}>
                      {(session) => (
                        <div
                          class="tree-session"
                          classList={{ active: projects.selectedSessionId() === session.id }}
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
                              onClick={() => void projects.selectSession(session)}
                            >
                              <span class="truncate">{sessionLabel(session)}</span>
                              <Show when={sessionDot(session.id)}>
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
                    </For>
                  </TreeCollapse>
                </div>
              )
            }}
          </Index>
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
          <Icon name="cog" />
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
                    <Icon name="times" />
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
