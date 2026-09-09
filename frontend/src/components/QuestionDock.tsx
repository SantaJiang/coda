import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { useApp } from "../store/app"

const CUSTOM = "__coda_custom__"

export function QuestionDock() {
  const app = useApp()
  const sessionId = () => app.state.selectedSessionId
  const pending = () => Object.values(app.state.questions).filter((item) => item && item.sessionID === sessionId())
  const [picked, setPicked] = createSignal<string[][]>([])
  const [customTexts, setCustomTexts] = createSignal<string[]>([])
  const [step, setStep] = createSignal(0)

  const request = () => pending()[0]
  const questions = createMemo(() => request()?.questions ?? [])
  const total = () => questions().length
  const index = () => Math.min(step(), Math.max(0, total() - 1))
  const current = () => questions()[index()]
  const many = () => total() > 1
  const last = () => index() >= total() - 1

  createEffect((prev?: string) => {
    const id = request()?.id
    if (id !== prev) {
      setPicked([])
      setCustomTexts([])
      setStep(0)
    }
    return id
  })

  const selectedAt = (questionIndex: number, label: string) => (picked()[questionIndex] ?? []).includes(label)

  const toggle = (questionIndex: number, label: string, multiple?: boolean) => {
    const next = picked().slice()
    const row = new Set(next[questionIndex] ?? [])
    if (multiple) {
      if (row.has(label)) row.delete(label)
      else row.add(label)
    } else {
      row.clear()
      row.add(label)
    }
    next[questionIndex] = [...row]
    setPicked(next)
  }

  const ensureCustom = (questionIndex: number, multiple?: boolean) => {
    if (selectedAt(questionIndex, CUSTOM)) return
    toggle(questionIndex, CUSTOM, multiple)
  }

  const setCustomText = (questionIndex: number, value: string) => {
    const next = customTexts().slice()
    next[questionIndex] = value
    setCustomTexts(next)
  }

  const answersFor = (questionIndex: number) => {
    const labels = (picked()[questionIndex] ?? []).filter((label) => label !== CUSTOM)
    const extra = (customTexts()[questionIndex] ?? "").trim()
    if ((picked()[questionIndex] ?? []).includes(CUSTOM) && extra) labels.push(extra)
    return labels
  }

  const answered = (questionIndex: number) => answersFor(questionIndex).length > 0
  const ready = () => answered(index())

  const firstUnanswered = () => questions().findIndex((_, questionIndex) => !answered(questionIndex))

  const submit = (id: string) => {
    const missing = firstUnanswered()
    if (missing >= 0 && missing !== index()) {
      setStep(missing)
      return
    }
    if (missing >= 0) return
    void app.replyQuestion(
      id,
      questions().map((_, questionIndex) => answersFor(questionIndex)),
    )
    setPicked([])
    setCustomTexts([])
    setStep(0)
  }

  return (
    <Show when={request()}>
      {(item) => (
        <div class="dock dock-question">
          <Show when={many()}>
            <div class="dock-title">问题 {index() + 1} / {total()}</div>
          </Show>
          <Show when={current()}>
            {(question) => {
              const selected = (label: string) => selectedAt(index(), label)
              return (
                <div class="question-block">
                  <div class="question-text">{question().question}</div>
                  <div class="question-options">
                    <For each={question().options}>
                      {(option) => (
                        <button
                          type="button"
                          class="question-option"
                          classList={{ picked: selected(option.label) }}
                          onClick={() => toggle(index(), option.label, question().multiple)}
                        >
                          <span class="question-option-label">{option.label}</span>
                          <Show when={option.description}>
                            <span class="question-option-desc">{option.description}</span>
                          </Show>
                        </button>
                      )}
                    </For>
                    <Show when={question().custom !== false}>
                      <div
                        class="question-option question-custom"
                        classList={{ picked: selected(CUSTOM) }}
                        onClick={() => toggle(index(), CUSTOM, question().multiple)}
                      >
                        <span class="question-option-label">其他</span>
                        <Show when={selected(CUSTOM)}>
                          <input
                            type="text"
                            value={customTexts()[index()] ?? ""}
                            autocomplete="off"
                            autofocus
                            onClick={(event) => event.stopPropagation()}
                            onFocus={() => ensureCustom(index(), question().multiple)}
                            onInput={(event) => {
                              setCustomText(index(), event.currentTarget.value)
                              ensureCustom(index(), question().multiple)
                            }}
                          />
                        </Show>
                      </div>
                    </Show>
                  </div>
                </div>
              )
            }}
          </Show>
          <div class="dock-actions">
            <Show when={many() && index() > 0}>
              <button type="button" class="ghost" onClick={() => setStep((value) => Math.max(0, value - 1))}>
                上一个
              </button>
            </Show>
            <span class="dock-actions-grow" />
            <button type="button" class="ghost" onClick={() => void app.rejectQuestion(item().id)}>
              跳过
            </button>
            <Show
              when={last()}
              fallback={
                <button
                  type="button"
                  class="primary"
                  disabled={!ready()}
                  onClick={() => ready() && setStep((value) => Math.min(total() - 1, value + 1))}
                >
                  下一个
                </button>
              }
            >
              <button type="button" class="primary" disabled={!ready()} onClick={() => ready() && submit(item().id)}>
                提交
              </button>
            </Show>
          </div>
        </div>
      )}
    </Show>
  )
}
