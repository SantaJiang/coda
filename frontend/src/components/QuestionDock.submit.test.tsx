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

const twoQuestions: QuestionRequest["questions"] = [
  { header: "方向", question: "第一题", options: [{ label: "A" }] },
  { header: "范围", question: "第二题", options: [{ label: "B" }] },
]

it("jumps to a question from the step indicator", async () => {
  const { container } = setup({ id: "frm_2", sessionID: "s1", questions: twoQuestions })
  const segments = container.querySelectorAll<HTMLButtonElement>(".step-seg")
  expect(segments).toHaveLength(2)
  expect(container.querySelector(".question-text")?.textContent).toBe("第一题")
  segments[1].click()
  await Promise.resolve()
  expect(container.querySelector(".question-text")?.textContent).toBe("第二题")
})

it("shows which questions are already answered", async () => {
  const { container } = setup({ id: "frm_3", sessionID: "s1", questions: twoQuestions })
  const segments = container.querySelectorAll<HTMLButtonElement>(".step-seg")
  container.querySelector<HTMLButtonElement>(".question-option")!.click()
  // 答完第一题后仍停在这题，active 优先于 answered
  expect(segments[0].dataset.state).toBe("active")
  segments[1].click()
  await Promise.resolve()
  expect(segments[0].dataset.state).toBe("answered")
  expect(segments[1].dataset.state).toBe("active")
})
