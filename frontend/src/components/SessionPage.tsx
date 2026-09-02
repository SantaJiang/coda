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
        <MessageTimeline />
      </Show>

      <Show when={app.selectedSession()}>
        <div class="composer-region">
          <QuestionDock />
          <PermissionDock />
          <TodoDock />
          <QueueDock />
          <Composer />
          <ContextBar />
        </div>
      </Show>
    </section>
  )
}
