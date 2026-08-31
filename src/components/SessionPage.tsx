import { Show } from "solid-js"
import { useApp } from "../store/app"
import { Composer } from "./Composer"
import { MessageTimeline } from "./MessageTimeline"
import { PermissionDock } from "./PermissionDock"
import { QuestionDock } from "./QuestionDock"
import { TodoDock } from "./TodoDock"

export function SessionPage() {
  const app = useApp()
  const title = () => app.selectedSession()?.title || "新会话"

  return (
    <section class="session">
      <header class="session-header">
        <div class="session-title truncate">{title()}</div>
        <Show when={app.state.error}>
          <div class="session-error">{app.state.error}</div>
        </Show>
      </header>

      <Show
        when={app.selectedSession()}
        fallback={
          <div class="empty">
            <div class="wordmark">Coda</div>
            <p>精简的 OpenCode Agent。选择左侧项目，然后开始一段会话。</p>
            <div class="empty-composer">
              <Composer />
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
          <Composer />
        </div>
      </Show>
    </section>
  )
}
