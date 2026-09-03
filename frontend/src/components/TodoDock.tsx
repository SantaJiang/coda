import { For, Show, createMemo } from "solid-js"
import { useApp } from "../store/app"

export function TodoDock() {
  const app = useApp()
  const todos = createMemo(() => {
    const id = app.state.selectedSessionId
    if (!id) return []
    return app.state.todos[id] ?? []
  })
  const done = () => todos().filter((item) => item.status === "completed").length

  return (
    <Show when={todos().length > 0}>
      <div class="plan-panel">
        <header class="plan-head">
          <div class="plan-title">计划</div>
          <div class="plan-count">
            {done()}/{todos().length}
          </div>
        </header>
        <ol class="plan-list">
          <For each={todos()}>
            {(todo, index) => (
              <li classList={{ done: todo.status === "completed", active: todo.status === "in_progress" }}>
                <span class="plan-index">{index() + 1}</span>
                <span class="plan-text">{todo.content}</span>
              </li>
            )}
          </For>
        </ol>
      </div>
    </Show>
  )
}
