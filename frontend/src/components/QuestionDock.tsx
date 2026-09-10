import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { AUTO_QUESTION_SECONDS, isAutoMode } from "../lib/permissions"
import type { QuestionInfo } from "../lib/types"
import { useChrome, useRuntime } from "../store/app"

const CUSTOM = "__coda_custom__"

const RECOMMENDED_PATTERN = /\(recommended\)\s*$/i

function recommendedOption(question?: QuestionInfo) {
  const options = question?.options ?? []
  if (options.length === 0) return undefined
  return options.find((option) => RECOMMENDED_PATTERN.test(option.label) || option.label.includes("推荐")) ?? options[0]
}

export function QuestionDock() {
  const runtime = useRuntime()
  const chrome = useChrome()
  const pending = () => runtime.pendingQuestions()
  const [picked, setPicked] = createSignal<string[][]>([])
  const [customTexts, setCustomTexts] = createSignal<string[]>([])
  const [step, setStep] = createSignal(0)
  const [countdown, setCountdown] = createSignal(AUTO_QUESTION_SECONDS)

  const request = () => pending()[0]
  const requestId = createMemo(() => request()?.id)
  const questions = createMemo(() => request()?.questions ?? [])
  const total = () => questions().length
  const index = () => Math.min(step(), Math.max(0, total() - 1))
  const current = () => questions()[index()]
  const many = () => total() > 1
  const last = () => index() >= total() - 1
  const auto = createMemo(() => isAutoMode(chrome.permissionMode()))

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

  const writePick = (questionIndex: number, label: string, multiple?: boolean) => {
    const next = picked().slice()
    const row = new Set(next[questionIndex] ?? [])
    if (multiple) row.add(label)
    else {
      row.clear()
      row.add(label)
    }
    next[questionIndex] = [...row]
    setPicked(next)
  }

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
    bump()
  }

  const ensureCustom = (questionIndex: number, multiple?: boolean) => {
    if (selectedAt(questionIndex, CUSTOM)) return
    toggle(questionIndex, CUSTOM, multiple)
  }

  const setCustomText = (questionIndex: number, value: string) => {
    const next = customTexts().slice()
    next[questionIndex] = value
    setCustomTexts(next)
    bump()
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
    void runtime.replyQuestion(
      id,
      questions().map((_, questionIndex) => answersFor(questionIndex)),
    )
    setPicked([])
    setCustomTexts([])
    setStep(0)
  }

  let timer: ReturnType<typeof setInterval> | undefined

  const clearTimer = () => {
    if (timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
  }

  const expire = () => {
    const item = request()
    if (!item) return
    const questionIndex = index()
    if (!answered(questionIndex)) {
      const recommended = recommendedOption(current())
      if (recommended) writePick(questionIndex, recommended.label, current()?.multiple)
    }
    if (last()) {
      questions().forEach((question, index) => {
        if (answered(index)) return
        const recommended = recommendedOption(question)
        if (recommended) writePick(index, recommended.label, question.multiple)
      })
      submit(item.id)
    } else setStep((value) => Math.min(total() - 1, value + 1))
  }

  const startCountdown = () => {
    clearTimer()
    setCountdown(AUTO_QUESTION_SECONDS)
    timer = setInterval(() => {
      const value = countdown()
      if (value > 1) {
        setCountdown(value - 1)
        return
      }
      clearTimer()
      setCountdown(0)
      expire()
    }, 1000)
  }

  const bump = () => {
    if (auto() && requestId()) startCountdown()
  }

  createEffect(() => {
    if (!auto() || !requestId()) {
      clearTimer()
      return
    }
    index()
    startCountdown()
  })

  onCleanup(clearTimer)

  return (
    <Show when={request()}>
      {(item) => (
        <div class="dock dock-question">
          <Show when={auto()}>
            <div class="question-auto">
              <span class="question-auto-badge">{countdown()}s</span>
              <span class="question-auto-text">无操作将自动选择推荐项</span>
            </div>
          </Show>
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
            <button type="button" class="ghost" onClick={() => void runtime.rejectQuestion(item().id)}>
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
