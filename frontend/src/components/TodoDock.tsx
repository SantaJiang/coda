import { Index, Show, createMemo } from "solid-js"
import { Icon } from "./Icon"
import { useChrome, useRuntime } from "../store/app"
import { ChromeDrag, WindowControls } from "./WindowChrome"

export function TodoDock(props: { embedded?: boolean } = {}) {
  const runtime = useRuntime()
  const chrome = useChrome()
  const todos = createMemo(() => runtime.todos())
  const done = () => todos().filter((item) => item.status === "completed").length

  return (
    <Show when={todos().length > 0}>
      <div class="plan-panel">
        <Show when={!props.embedded}><ChromeDrag class="plan-head">
          <div class="plan-title" data-tauri-drag-region="">
            计划
          </div>
          <div class="plan-count" data-tauri-drag-region="">
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
          <WindowControls />
        </ChromeDrag></Show>
        <Show when={!runtime.busy() && todos().some((todo) => todo.status === "pending" || todo.status === "in_progress")}>
          <div class="plan-unfinished" role="status">计划仍有 {todos().filter((todo) => todo.status === "pending" || todo.status === "in_progress").length} 项未完成</div>
        </Show>
        <ol class="plan-list">
          <Index each={todos()}>
            {(todo, index) => (
              <li classList={{ done: todo().status === "completed", active: runtime.busy() && todo().status === "in_progress" }}>
                <span class="plan-index">{index + 1}</span>
                <span class="plan-text">{todo().content}</span>
              </li>
            )}
          </Index>
        </ol>
      </div>
    </Show>
  )
}
