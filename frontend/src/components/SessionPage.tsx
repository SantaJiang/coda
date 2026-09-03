import { Show } from "solid-js"
import { useApp } from "../store/app"
import { Composer } from "./Composer"
import { ContextBar } from "./ContextBar"
import { MessageTimeline } from "./MessageTimeline"
import { PermissionDock } from "./PermissionDock"
import { QuestionDock } from "./QuestionDock"
import { QueueDock } from "./QueueDock"
import { TodoDock } from "./TodoDock"

export function SessionPage() {
  const app = useApp()
  const hasPlan = () => {
    const id = app.state.selectedSessionId
    if (!id) return false
    return (app.state.todos[id] ?? []).length > 0
  }

  return (
    <section class="session">
      <Show when={app.state.error}>
        <div class="session-error">{app.state.error}</div>
      </Show>

      <Show
        when={app.selectedSession()}
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
          <Show when={hasPlan()}>
            <aside class="session-aside">
              <TodoDock />
            </aside>
          </Show>
        </div>
      </Show>
    </section>
  )
}
