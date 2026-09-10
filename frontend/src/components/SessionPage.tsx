import { Show } from "solid-js"
import { useChrome, useProjects, useRuntime } from "../store/app"
import { Composer } from "./Composer"
import { ContextBar } from "./ContextBar"
import { MessageTimeline } from "./MessageTimeline"
import { PermissionDock } from "./PermissionDock"
import { QuestionDock } from "./QuestionDock"
import { QueueDock } from "./QueueDock"
import { TodoDock } from "./TodoDock"

export function SessionPage() {
  const projects = useProjects()
  const runtime = useRuntime()
  const chrome = useChrome()

  return (
    <section class="session">
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
        <div class="session-body">
          <div class="session-main">
            <MessageTimeline />
            <div class="composer-region">
              <QuestionDock />
              <PermissionDock />
              <QueueDock />
              <Composer />
              <ContextBar />
            </div>
          </div>
          <Show when={runtime.hasPlan() && !chrome.planPanelDismissed()}>
            <aside class="session-aside">
              <TodoDock />
            </aside>
          </Show>
        </div>
      </Show>
    </section>
  )
}
