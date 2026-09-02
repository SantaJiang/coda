import { For, Show, createEffect, createSignal } from "solid-js"
import { useApp } from "../store/app"

const CUSTOM = "__coda_custom__"

export function QuestionDock() {
  const app = useApp()
  const sessionId = () => app.state.selectedSessionId
  const pending = () => Object.values(app.state.questions).filter((item) => item && item.sessionID === sessionId())
  const [picked, setPicked] = createSignal<string[][]>([])
  const [customTexts, setCustomTexts] = createSignal<string[]>([])

  const request = () => pending()[0]

  createEffect((prev?: string) => {
    const id = request()?.id
    if (id !== prev) {
      setPicked([])
      setCustomTexts([])
    }
    return id
  })

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

  const ensureCustom = (index: number, multiple?: boolean) => {
    if ((picked()[index] ?? []).includes(CUSTOM)) return
    toggle(index, CUSTOM, multiple)
  }

  const setCustomText = (index: number, value: string) => {
    const next = customTexts().slice()
    next[index] = value
    setCustomTexts(next)
  }

  return (
    <Show when={request()}>
      {(item) => (
        <div class="dock dock-question">
          <div class="dock-title">Agent 想确认几个问题</div>
          <For each={item().questions}>
            {(question, index) => {
              const selected = (label: string) => (picked()[index()] ?? []).includes(label)
              return (
                <div class="question-block">
                  <div class="question-text">{question.question}</div>
                  <div class="question-options">
                    <For each={question.options}>
                      {(option) => (
                        <button
                          type="button"
                          class="question-option"
                          classList={{ picked: selected(option.label) }}
                          onClick={() => toggle(index(), option.label, question.multiple)}
                        >
                          <span class="question-option-label">{option.label}</span>
                          <Show when={option.description}>
                            <span class="question-option-desc">{option.description}</span>
                          </Show>
                        </button>
                      )}
                    </For>
                    <div
                      class="question-option question-custom"
                      classList={{ picked: selected(CUSTOM) }}
                      onClick={() => toggle(index(), CUSTOM, question.multiple)}
                    >
                      <span class="question-option-label">其他</span>
                      <input
                        type="text"
                        value={customTexts()[index()] ?? ""}
                        placeholder="输入其他内容"
                        autocomplete="off"
                        onClick={(event) => event.stopPropagation()}
                        onFocus={() => ensureCustom(index(), question.multiple)}
                        onInput={(event) => {
                          setCustomText(index(), event.currentTarget.value)
                          ensureCustom(index(), question.multiple)
                        }}
                      />
                    </div>
                  </div>
                </div>
              )
            }}
          </For>
          <div class="dock-actions">
            <button type="button" class="ghost" onClick={() => void app.rejectQuestion(item().id)}>
              跳过
            </button>
            <button
              type="button"
              class="primary"
              onClick={() => {
                const answers = item().questions.map((_, index) => {
                  const labels = (picked()[index] ?? []).filter((label) => label !== CUSTOM)
                  const extra = (customTexts()[index] ?? "").trim()
                  if ((picked()[index] ?? []).includes(CUSTOM) && extra) labels.push(extra)
                  return labels
                })
                void app.replyQuestion(item().id, answers)
                setPicked([])
                setCustomTexts([])
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
