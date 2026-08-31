import { For, Show, createMemo, createSignal } from "solid-js"
import { useApp } from "../store/app"

export function TodoDock() {
  const app = useApp()
  const [collapsed, setCollapsed] = createSignal(false)
  const todos = createMemo(() => {
    const id = app.state.selectedSessionId
    if (!id) return []
    return app.state.todos[id] ?? []
  })
  const done = () => todos().filter((item) => item.status === "completed").length

  return (
    <Show when={todos().length > 0}>
      <div class="dock dock-todo">
        <button type="button" class="todo-head" onClick={() => setCollapsed((value) => !value)}>
          <span>
            任务 {done()}/{todos().length}
          </span>
          <span class="muted">{collapsed() ? "展开" : "收起"}</span>
        </button>
        <Show when={!collapsed()}>
          <ul class="todo-list">
            <For each={todos()}>
              {(todo) => (
                <li classList={{ done: todo.status === "completed", active: todo.status === "in_progress" }}>
                  <span class="todo-mark" />
                  <span>{todo.content}</span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </Show>
  )
}
