import { Show } from "solid-js"
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

export function SessionPage() {
  const projects = useProjects()
  const runtime = useRuntime()
  const chrome = useChrome()
  const showAside = () => runtime.hasPlan() && !chrome.planPanelDismissed()
  const chromeTitle = () => {
    const session = projects.selectedSession()
    return session ? formatSessionTitle(session.title) : "新会话"
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
            when={projects.selectedSession()}
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
              <Composer />
              <ContextBar />
            </div>
          </Show>
        </div>
        <Show when={showAside()}>
          <aside class="session-aside">
            <TodoDock />
          </aside>
        </Show>
      </div>
    </section>
  )
}
