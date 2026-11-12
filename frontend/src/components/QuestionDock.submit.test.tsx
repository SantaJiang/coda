import { afterEach, expect, it, vi } from "vitest"
import { render } from "solid-js/web"
import { StoreProviders } from "../store/ctx"
import type { ChromeApi, ModelApi, ProjectApi, RuntimeApi } from "../store/contracts"
import type { QuestionRequest } from "../lib/types"
import { QuestionDock } from "./QuestionDock"

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function setup(question: QuestionRequest, overrides: Partial<RuntimeApi> = {}) {
  const replyQuestion = vi.fn().mockResolvedValue(undefined)
  const runtime = {
    pendingQuestions: () => [question],
    replyQuestion,
    rejectQuestion: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as RuntimeApi
  const container = document.createElement("div")
  document.body.append(container)
  const dispose = render(
    () => (
      <StoreProviders
        runtime={runtime}
        projects={{} as ProjectApi}
        models={{} as ModelApi}
        chrome={{ permissionMode: () => "default" } as ChromeApi}
      >
        <QuestionDock />
      </StoreProviders>
    ),
    container,
  )
  cleanups.push(() => {
    dispose()
    container.remove()
  })
  return { container, replyQuestion }
}

it("submits the picked answer", async () => {
  const { container, replyQuestion } = setup({
    id: "frm_1",
    sessionID: "s1",
    questions: [
      {
        header: "方向",
        question: "选一个",
        options: [{ label: "A" }, { label: "B" }],
        custom: true,
      },
    ],
  })
  const options = container.querySelectorAll<HTMLButtonElement>(".question-option")
  options[0].click()
  const submit = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "提交")!
  submit.click()
  await Promise.resolve()
  expect(replyQuestion).toHaveBeenCalledWith("frm_1", [["A"]])
})