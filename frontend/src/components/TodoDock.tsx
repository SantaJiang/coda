import { For, Show, createMemo } from "solid-js"
import { Icon } from "./Icon"
import { useChrome, useRuntime } from "../store/app"

export function TodoDock() {
  const runtime = useRuntime()
  const chrome = useChrome()
  const todos = createMemo(() => runtime.todos())
  const done = () => todos().filter((item) => item.status === "completed").length

  return (
    <Show when={todos().length > 0}>
      <div class="plan-panel">
        <header class="plan-head">
          <div class="plan-title">计划</div>
          <div class="plan-head-right">
            <div class="plan-count">
              {done()}/{todos().length}
            </div>
            <button
              type="button"
              class="plan-close"
              aria-label="关闭计划栏"
              title="关闭"
              onClick={() => chrome.closePlanPanel()}
            >
              <Icon name="times" />
            </button>
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
