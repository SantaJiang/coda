import { afterEach, describe, expect, it, vi } from "vitest"
import { createMemo, createRoot, createSignal } from "solid-js"
import { render } from "solid-js/web"
import { StoreProviders } from "../store/ctx"
import type { ChromeApi, ModelApi, ProjectApi, RuntimeApi } from "../store/contracts"
import { conversationTurns, emptyTimelineView } from "../lib/conversation"
import type { AssistantMessage, Part, SessionStatus, UserMessage } from "../lib/types"
import { ChatTurnView } from "./MessagePart"

const cleanups: Array<() => void> = []
const user: UserMessage = { id: "u1", sessionID: "s1", role: "user", time: { created: 1 } }
const assistant = (done = false): AssistantMessage => ({ id: "a1", sessionID: "s1", parentID: "u1", role: "assistant", time: { created: 2, ...(done ? { completed: 8 } : {}) }, ...(done ? { finish: "stop" } : {}) })
const part = (id: string, type: "text" | "reasoning", text: string): Part => ({ id, type, text, sessionID: "s1", messageID: "a1" })
const tool: Part = { id: "t1", type: "tool", tool: "read", callID: "t1", sessionID: "s1", messageID: "a1", state: { status: "completed", input: { filePath: "app.ts" }, output: "contents" } }

afterEach(() => { vi.useRealTimers(); window.getSelection()?.removeAllRanges(); while (cleanups.length) cleanups.pop()?.() })
function setup(initial: Part[] = [], completed = false, extra: Partial<AssistantMessage> = {}) {
  return createRoot((disposeRoot) => {
  const [parts, setParts] = createSignal(initial)
  const [done, setDone] = createSignal(completed)
  const [following, setFollowing] = createSignal(true)
  const [status, setStatus] = createSignal<SessionStatus>(completed ? { type: "idle" } : { type: "busy" })
  const [view, setView] = createSignal(emptyTimelineView())
  const map = createMemo(() => ({ a1: parts(), u1: [part("user-text", "text", "问题")] }))
  const turn = createMemo(() => conversationTurns([user, { ...assistant(done()), ...extra }], map(), { status: status() })[0])
  const container = document.createElement("div")
  document.body.appendChild(container)
  const runtime = { busy: () => false, timelineView: view, updateTimelineView: (patch: Partial<ReturnType<typeof view>>) => setView({ ...view(), ...patch }) } as unknown as RuntimeApi
  const dispose = render(() => <StoreProviders projects={{} as ProjectApi} models={{ nameFor: () => "model" } as ModelApi} runtime={runtime} chrome={{} as ChromeApi}>
    <ChatTurnView turn={turn()} partsByMessage={map()} following={following()} />
  </StoreProviders>, container)
  cleanups.push(() => { dispose(); disposeRoot(); container.remove() })
  return { container, setParts, setDone, setStatus, setFollowing }
  })
}

describe("streaming turn presentation", () => {
  it("keeps the upward status transition when a work group gives way to prose", () => {
    vi.useFakeTimers()
    const { container, setParts } = setup([tool])
    expect(container.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Planning next moves")
    setParts([tool, part("p1", "text", "# 正在汇总")])
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1)
    expect(container.querySelector(".turn-status .flipping .out")?.textContent).toBe("Planning next moves")
    expect(container.querySelector(".turn-status .flipping .in")?.textContent).toBe("Writing response")
    vi.advanceTimersByTime(320)
    expect(container.querySelector(".out")).toBeNull()
  })

  it("shows the failure card without a second failed status", () => {
    const { container } = setup([], true, { error: { data: { message: "供应商超时" } }, finish: "error" })
    expect(container.querySelector(".error-card")?.textContent).toBe("供应商超时")
    expect(container.textContent).not.toContain("回复失败")
  })

  it("does not add view-terminal links to command steps", () => {
    const shell = { ...tool, tool: "shell", state: { status: "completed", input: { command: "git status" }, output: "clean", metadata: { terminalID: "term-fast" } } } as Part
    const { container } = setup([shell], true)
    ;(container.querySelector(".worked-for > .work-head") as HTMLButtonElement).click()
    ;(container.querySelector(".work-group > .work-head") as HTMLButtonElement).click()
    expect(container.textContent).not.toContain("查看终端")
    expect(container.querySelector(".work-terminal-link")).toBeNull()
  })

  it("lets shell and read steps expand like Thought rows", () => {
    const shell = { ...tool, id: "sh1", tool: "shell", state: { status: "completed", input: { command: "git status" }, output: "clean" } } as Part
    const { container } = setup([shell, tool])
    ;(container.querySelector(".work-group > .work-head") as HTMLButtonElement).click()
    const heads = [...container.querySelectorAll<HTMLButtonElement>(".work-step-head")]
    expect(heads.length).toBeGreaterThanOrEqual(2)
    for (const head of heads) {
      expect(head.disabled).toBe(false)
      expect(head.querySelector(".work-step-caret")).toBeTruthy()
    }
    heads[0]!.click()
    expect(container.querySelector(".tool-details")?.textContent).toMatch(/git status|clean/)
  })

  it("closes as a single Thinking row and lays markdown out when the pure group opens", () => {
    const { container, setParts } = setup()
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1)
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Planning next moves")
    setParts([part("r1", "reasoning", "思考原文")])
    // Glass closed activity group: one summary row, no 144px preview.
    expect(container.querySelector(".work-preview")).toBeNull()
    expect(container.querySelector(".work-group > .work-head")?.textContent).toContain("Thinking")
    expect(container.querySelector(".thinking-body")).toBeNull()
    // Cursor: pure Thinking already owns the status — no second Thinking line.
    expect(container.querySelector(".turn-status")).toBeNull()
    ;(container.querySelector(".work-group > .work-head") as HTMLButtonElement).click()
    expect(container.querySelector(".thinking-line")).toBeNull()
    expect(container.querySelector(".thinking-body")?.textContent).toContain("思考原文")
    expect(container.querySelector(".turn-status")).toBeNull()
    expect(container.querySelector(".work-preview")).toBeNull()
  })

  it("opens the mixed group without a loading preview or auto-expanding Thought", () => {
    const reasoning = { ...part("r1", "reasoning", "先看目录"), time: { start: 1 } } as Part
    const { container } = setup([tool, reasoning])
    expect(container.querySelector(".work-preview")).toBeNull()
    expect(container.querySelector(".turn-status [role=\"status\"]")?.textContent).toContain("Thinking")
    expect(container.querySelector(".thinking-body")).toBeNull()
    ;(container.querySelector(".work-group > .work-head") as HTMLButtonElement).click()
    expect(container.querySelector(".work-group.open")).toBeTruthy()
    expect(container.querySelector(".turn-status")).toBeNull()
    expect(container.querySelector(".thinking-body")).toBeNull()
    ;(container.querySelector(".thinking-line .work-step-head") as HTMLButtonElement).click()
    expect(container.querySelector(".thinking-body")?.textContent).toContain("先看目录")
  })

  it("preserves prose nodes and detail expansion as the answer grows", () => {
    const { container, setParts } = setup([part("p1", "text", "先检查"), tool])
    ;(container.querySelector(".work-group > .work-head") as HTMLButtonElement).click()
    const prose = container.querySelector('[data-entry-key="a1:p1"]')
    ;(container.querySelector(".work-step-head") as HTMLButtonElement).click()
    setParts([part("p1", "text", "先检查"), tool, part("p2", "text", "结论")])
    expect(container.querySelector('[data-entry-key="a1:p1"]')).toBe(prose)
    expect(container.querySelector(".tool-details")?.textContent).toContain("contents")
    expect([...container.querySelectorAll("[data-entry-key]")].map((element) => element.getAttribute("data-entry-key"))).toEqual(["a1:p1", "a1:t1", "a1:p2"])
  })

  it("groups only after the run ends and restores step expansion", () => {
    const { container, setDone, setStatus } = setup([part("p1", "text", "先检查"), tool, part("p2", "text", "最终结论")])
    ;(container.querySelector(".work-group > .work-head") as HTMLButtonElement).click()
    ;(container.querySelector(".work-step-head") as HTMLButtonElement).click()
    setDone(true)
    expect(container.querySelector(".final-answer")).toBeNull()
    setStatus({ type: "idle" })
    expect(container.querySelector(".final-answer")?.textContent).toContain("最终结论")
    expect(container.querySelector('[data-entry-key="a1:p1"]')).toBeNull()
    ;(container.querySelector(".worked-for > .work-head") as HTMLButtonElement).click()
    expect(container.querySelector('[data-entry-key="a1:p1"]')?.textContent).toContain("先检查")
    expect(container.querySelector(".tool-details")?.textContent).toContain("contents")
  })

  it("defers grouping while the user reads earlier content", () => {
    const { container, setDone, setStatus, setFollowing } = setup([tool, part("p1", "text", "最终结论")])
    setFollowing(false)
    setDone(true)
    setStatus({ type: "idle" })
    expect(container.querySelector(".final-answer")).toBeNull()
    expect(container.querySelector('[data-block-key="work:a1:t1"]')).toBeTruthy()
    expect(container.querySelector('.worked-for > .work-head')?.getAttribute("aria-expanded")).toBe("true")
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(0)
    setFollowing(true)
    expect(container.querySelector(".final-answer")?.textContent).toContain("最终结论")
  })

  it("does not show an empty summary for text-only history", () => {
    const { container } = setup([part("p1", "text", "纯文字回答")], true)
    expect(container.querySelector(".turn-status")).toBeNull()
    expect(container.querySelector(".final-answer")?.textContent).toContain("纯文字回答")
  })

  it("keeps encrypted reasoning inert and tool errors visible", () => {
    const { container, setParts } = setup([part("r1", "reasoning", "")])
    expect((container.querySelector(".work-group > .work-head") as HTMLButtonElement).disabled).toBe(true)
    setParts([{ ...tool, state: { status: "error", input: {}, error: "read failed" } } as Part])
    expect(container.querySelector(".work-failure")?.textContent).toContain("1 项失败")
    expect(container.querySelector(".turn-status [role=\"status\"]")?.textContent).toContain("Planning next moves")
    ;(container.querySelector(".work-group > .work-head") as HTMLButtonElement).click()
    expect(container.querySelector(".step-error-preview")?.textContent).toContain("read failed")
    // Settled open group is not a live owner — planning status stays visible.
    expect(container.querySelector(".turn-status [role=\"status\"]")?.textContent).toContain("Planning next moves")
  })

  it("separates activity groups with prose and expands only the selected group", () => {
    const nextTool: Part = { ...tool, id: "t2", callID: "t2", tool: "bash", state: { status: "completed", input: { command: "bun run build" }, output: "built" } }
    const { container } = setup([
      part("r0", "reasoning", "先确认需求"), part("p1", "text", "# 先检查文件"),
      tool, part("r1", "reasoning", "检查结果"), part("p2", "text", "# 然后构建"), nextTool,
      part("p3", "text", "# 最终结论"),
    ])
    expect(container.querySelectorAll(".conversation-work-block")).toHaveLength(3)
    expect(container.querySelectorAll(".work-step")).toHaveLength(0)
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1)
    const heads = container.querySelectorAll<HTMLButtonElement>(".work-group > .work-head")
    expect(heads[1].textContent).toContain("Explored 1 file")
    expect(heads[2].textContent).toContain("Ran 1 command")
    heads[1].click()
    expect(container.querySelectorAll(".work-step")).toHaveLength(2)
    expect(container.querySelectorAll(".work-group.open")).toHaveLength(1)
    expect([...container.querySelectorAll(".work-step-head")].map((head) => head.textContent)).toEqual([expect.stringContaining("Read app.ts"), expect.stringContaining("Thinking")])
    expect(container.querySelector(".tool-details")).toBeNull()
    expect(container.querySelector(".step-state")).toBeNull()
  })

  it("keeps the current group stable as new operations arrive, then moves status to the prose tail", () => {
    const { container, setParts } = setup([part("p1", "text", "先检查"), tool])
    const group = container.querySelector(".work-group")
    expect(container.querySelector(".work-preview")).toBeNull()
    expect(container.querySelector(".turn-status [role=\"status\"]")).toBeTruthy()
    ;(container.querySelector(".work-group > .work-head") as HTMLButtonElement).click()
    setParts([part("p1", "text", "先检查"), tool, { ...tool, id: "t2", callID: "t2", state: { status: "running", input: { filePath: "other.ts" } } } as Part])
    expect(container.querySelector(".work-group")).toBe(group)
    expect(container.querySelector(".work-group.open")).toBe(group)
    expect(container.querySelector(".turn-status")).toBeNull()
    expect(container.querySelector(".work-preview")).toBeNull()
    setParts([part("p1", "text", "先检查"), tool, part("p2", "text", "# 继续处理")])
    expect(container.querySelector(".work-group")).toBe(group)
    expect(container.querySelector('.turn-status [role="status"]')?.textContent).toContain("Writing response")
  })

  it("does not replace inspected step contents when completion is deferred, and allows manual folding", () => {
    const { container, setDone, setStatus, setFollowing } = setup([part("p1", "text", "先检查"), tool, part("p2", "text", "最终结论")])
    ;(container.querySelector(".work-group > .work-head") as HTMLButtonElement).click()
    ;(container.querySelector(".work-step-head") as HTMLButtonElement).click()
    const details = container.querySelector(".tool-details")
    setFollowing(false)
    setDone(true)
    setStatus({ type: "idle" })
    expect(container.querySelector(".tool-details")).toBe(details)
    expect(container.querySelector('.worked-for > .work-head')?.getAttribute("aria-expanded")).toBe("true")
    ;(container.querySelector('.worked-for > .work-head') as HTMLButtonElement).click()
    expect(container.querySelector(".tool-details")).toBeNull()
    expect(container.querySelector(".final-answer")?.textContent).toContain("最终结论")
    ;(container.querySelector('.worked-for > .work-head') as HTMLButtonElement).click()
    expect(container.querySelector(".tool-details")?.textContent).toContain("contents")
  })

  it("keeps completed thought duration separate from the next live activity", () => {
    const thought: Part = { ...part("r1", "reasoning", "考虑完成"), time: { start: 1000, end: 3000 } } as Part
    const { container, setDone, setStatus } = setup([thought])
    expect(container.querySelector('.work-group > .work-head')?.textContent).toContain("Thinking")
    expect(container.querySelector(".work-preview")).toBeNull()
    setDone(true)
    setStatus({ type: "idle" })
    expect(container.querySelector('.worked-for > .work-head')?.textContent).toContain("Worked for")
    ;(container.querySelector('.worked-for > .work-head') as HTMLButtonElement).click()
    expect(container.querySelector('.work-group > .work-head')?.textContent).toContain("Thought 2s")
  })

  it("keeps an open pure-thought body visible as ThinkingLine when tools join", () => {
    const thought = part("r1", "reasoning", "原来的思考内容")
    const { container, setParts } = setup([thought])
    ;(container.querySelector(".work-group > .work-head") as HTMLButtonElement).click()
    expect(container.querySelector(".thinking-body")?.textContent).toContain("原来的思考内容")
    setParts([thought, tool])
    expect(container.querySelectorAll(".work-group.open")).toHaveLength(1)
    expect(container.querySelector(".thinking-line.open .thinking-body")?.textContent).toContain("原来的思考内容")
    ;(container.querySelector('[data-entry-key="a1:r1"] .work-step-head') as HTMLButtonElement).click()
    expect(container.querySelector(".thinking-body")).toBeNull()
  })

  it("never shows Thought chrome, ThinkingLine, and live Thinking together", () => {
    const reasoning = { ...part("r1", "reasoning", "一边想一边读"), time: { start: 1 } } as Part
    const { container } = setup([tool, reasoning])
    // Closed: summary + tail status only. No preview stack.
    expect(container.querySelectorAll(".work-step-action")).toHaveLength(0)
    expect(container.querySelector(".work-preview")).toBeNull()
    const closedLabels = [...container.querySelectorAll(".work-summary-text, .turn-status [role='status']")]
      .map((node) => node.textContent?.trim() ?? "")
    expect(closedLabels.filter((text) => text === "Thinking").length).toBeLessThanOrEqual(1)
    ;(container.querySelector(".work-group > .work-head") as HTMLButtonElement).click()
    expect(container.querySelector(".turn-status")).toBeNull()
    expect(container.querySelector(".work-preview")).toBeNull()
    // Open mixed: tool/thinking step heads only — no duplicate turn Thinking.
    expect([...container.querySelectorAll(".work-step-action")].map((node) => node.textContent)).toEqual([
      "Read",
      "Thinking",
    ])
  })

  it("keeps Planning next moves while a completed Thought stays open", () => {
    const doneThought = { ...part("r1", "reasoning", "上一轮想完了"), time: { start: 1, end: 3 } } as Part
    const { container } = setup([doneThought])
    expect(container.querySelector(".turn-status [role=\"status\"]")?.textContent).toContain("Planning next moves")
    ;(container.querySelector(".work-group > .work-head") as HTMLButtonElement).click()
    expect(container.querySelector(".thinking-body")?.textContent).toContain("上一轮想完了")
    // Completed open group must not hide the planning gap status (Glass Oja).
    expect(container.querySelector(".turn-status [role=\"status\"]")?.textContent).toContain("Planning next moves")
  })

  it("does not leave a quote-only thinking body or caret row", () => {
    const hollow = { ...part("r1", "reasoning", ">\n>  "), time: { start: 1, end: 2 } } as Part
    const real = { ...part("r2", "reasoning", "真正的思考"), time: { start: 3, end: 5 } } as Part
    const { container } = setup([hollow, real])
    ;(container.querySelector(".work-group > .work-head") as HTMLButtonElement).click()
    expect([...container.querySelectorAll(".thinking-body")].map((node) => node.textContent?.trim())).toEqual(["真正的思考"])
    expect(container.querySelectorAll(".thinking-line")).toHaveLength(0)
    expect(container.textContent).not.toMatch(/(^|\n)\s*>\s*(\n|$)/)
  })

  it("keeps the second-line status clickable without a caret glyph", () => {
    const reasoning = { ...part("r1", "reasoning", "点状态展开"), time: { start: 1 } } as Part
    const { container } = setup([tool, reasoning])
    const status = container.querySelector(".turn-status .work-status-head") as HTMLButtonElement
    expect(status).toBeTruthy()
    expect(status.querySelector(".work-summary-caret")).toBeNull()
    expect(status.textContent).toContain("Thinking")
    expect(status.textContent).not.toContain(">")
    status.click()
    expect(container.querySelector(".work-group.open")).toBeTruthy()
    expect(container.querySelector(".thinking-line.open .thinking-body")?.textContent).toContain("点状态展开")
    expect(container.querySelector(".turn-status")).toBeNull()
  })

  it("auto-collapses a ThinkingLine after that thought finishes", () => {
    const live = { ...part("r1", "reasoning", "正在想"), time: { start: 1 } } as Part
    const { container, setParts } = setup([tool, live])
    ;(container.querySelector(".work-group > .work-head") as HTMLButtonElement).click()
    ;(container.querySelector(".thinking-line .work-step-head") as HTMLButtonElement).click()
    expect(container.querySelector(".thinking-line.open .thinking-body")?.textContent).toContain("正在想")
    setParts([tool, { ...live, time: { start: 1, end: 4 } } as Part])
    expect(container.querySelector(".thinking-line.open")).toBeNull()
    expect(container.querySelector(".thinking-body")).toBeNull()
    expect(container.querySelector(".thinking-line .work-step-action")?.textContent).toMatch(/Thought/)
  })
})
