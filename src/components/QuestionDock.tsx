import { For, Show, createSignal } from "solid-js"
import { useApp } from "../store/app"

export function QuestionDock() {
  const app = useApp()
  const sessionId = () => app.state.selectedSessionId
  const pending = () => Object.values(app.state.questions).filter((item) => item && item.sessionID === sessionId())
  const [picked, setPicked] = createSignal<string[][]>([])

  const request = () => pending()[0]

  const toggle = (index: number, label: string, multiple?: boolean) => {
    const current = picked().slice()
    const row = new Set(current[index] ?? [])
    if (multiple) {
      if (row.has(label)) row.delete(label)
      else row.add(label)
    } else {
      row.clear()
      row.add(label)
    }
    current[index] = [...row]
    setPicked(current)
  }

  return (
    <Show when={request()}>
      {(item) => (
        <div class="dock dock-question">
          <div class="dock-title">Agent 想确认几个问题</div>
          <For each={item().questions}>
            {(question, index) => (
              <div class="question-block">
                <div class="question-text">{question.question}</div>
                <div class="question-options">
                  <For each={question.options}>
                    {(option) => {
                      const selected = () => (picked()[index()] ?? []).includes(option.label)
                      return (
                        <button
                          type="button"
                          class="question-option"
                          classList={{ picked: selected() }}
                          onClick={() => toggle(index(), option.label, question.multiple)}
                        >
                          {option.label}
                        </button>
                      )
                    }}
                  </For>
                </div>
              </div>
            )}
          </For>
          <div class="dock-actions">
            <button type="button" class="ghost" onClick={() => void app.rejectQuestion(item().id)}>
              跳过
            </button>
            <button
              type="button"
              class="primary"
              onClick={() => {
                const answers = item().questions.map((_, index) => picked()[index] ?? [])
                void app.replyQuestion(item().id, answers)
                setPicked([])
              }}
            >
              提交
            </button>
          </div>
        </div>
      )}
    </Show>
  )
}
