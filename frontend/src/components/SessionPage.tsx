import { TerminalDock } from "./TerminalDock"
import { useTerminals } from "../lib/terminals"
import { Show, Suspense, lazy, onCleanup } from "solid-js"
import { isLocalDraft, draftSidebarTitle } from "../lib/draft-session"
import { formatSessionTitle } from "../lib/session-label"
import { useChrome, useProjects, useRuntime } from "../store/app"
import { Composer } from "./Composer"
import { ContextBar } from "./ContextBar"
import { MessageTimeline } from "./MessageTimeline"
import { PermissionDock } from "./PermissionDock"
import { QuestionDock } from "./QuestionDock"
import { QueueDock } from "./QueueDock"
import { TodoDock } from "./TodoDock"
import { ChromeDrag, WindowControls } from "./WindowChrome"

const TerminalPanel = lazy(() => import("./TerminalPanel"))

export function SessionPage() {
  const projects = useProjects()
  const runtime = useRuntime()
  const chrome = useChrome()
  const terminals = useTerminals(() => projects.selectedProject()?.path, () => projects.selectedSession()?.id)
  const planAvailable = () => runtime.hasPlan() && !chrome.planPanelDismissed()
  const showAside = () => terminals.view().open || planAvailable()
  const showTerminal = () => terminals.view().open && terminals.view().tab === "terminal"
  const resize = (event: PointerEvent) => {
    event.preventDefault()
    const start = event.clientX, width = terminals.view().width
    const move = (event: PointerEvent) => terminals.patch({ width: Math.max(260, Math.min(700, width + start - event.clientX)) })
    const end = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end) }
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", end)
    onResizeCleanup = end
  }
  let onResizeCleanup: (() => void) | undefined
  onCleanup(() => onResizeCleanup?.())
  const selected = () => projects.selectedSession()
  const isDraftView = () => (!selected() || isLocalDraft(selected())) && runtime.messages().length === 0
  const chromeTitle = () => {
    const session = selected()
    if (!session || isLocalDraft(session)) return draftSidebarTitle(runtime.composer())
    return formatSessionTitle(session.title)
  }

  return (
    <section class="session">
      <div class="session-body">
        <div class="session-main">
          <ChromeDrag class="session-chrome">
            <span class="session-chrome-title truncate" data-tauri-drag-region="">
              {chromeTitle()}
            </span>
            <Show when={!showAside()}>
              <WindowControls />
            </Show>
          </ChromeDrag>
          <Show when={projects.error()}>
            <div class="session-error">{projects.error()}</div>
          </Show>
          <Show
            when={!isDraftView()}
            fallback={
              <div class="empty">
                <div class="empty-composer">
                  <Composer />
                  <ContextBar />
                </div>
              </div>
            }
          >
            <MessageTimeline />
            <div class="composer-region">
              <QuestionDock />
              <PermissionDock />
              <QueueDock />
              <TerminalDock terminals={terminals} />
              <Composer />
              <ContextBar />
            </div>
          </Show>
        </div>
        <Show when={showAside()}>
          <aside class="session-aside terminal-aside" style={{ "--terminal-width": `${terminals.view().width}px` }}>
            <div class="aside-resize" onPointerDown={resize} role="separator" aria-orientation="vertical" aria-label="调整侧栏宽度" />
            <header class="terminal-panel-head">
              <button classList={{ active: showTerminal() }} onClick={() => terminals.patch({ open: true, tab: "terminal" })}>终端</button>
              <Show when={runtime.hasPlan()}><button classList={{ active: !showTerminal() }} onClick={() => terminals.patch({ open: true, tab: "plan" })}>计划</button></Show>
              <span class="terminal-head-space" /><WindowControls />
              <button class="icon-btn" aria-label="关闭侧栏" onClick={() => { terminals.patch({ open: false }); chrome.closePlanPanel() }}>×</button>
            </header>
            <Show when={showTerminal()} fallback={<TodoDock embedded />}>
              <Suspense fallback={<div class="terminal-notice">正在加载终端…</div>}>
                <TerminalPanel terminals={terminals} directory={projects.selectedProject()?.path ?? ""} sessionID={selected()?.id ?? ""} />
              </Suspense>
            </Show>
          </aside>
        </Show>
      </div>
    </section>
  )
}
