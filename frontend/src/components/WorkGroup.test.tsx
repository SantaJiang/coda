import { afterEach, describe, expect, it } from "vitest"
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

afterEach(() => { window.getSelection()?.removeAllRanges(); while (cleanups.length) cleanups.pop()?.() })
function setup(initial: Part[] = [], completed = false) {
  return createRoot((disposeRoot) => {
  const [parts, setParts] = createSignal(initial)
  const [done, setDone] = createSignal(completed)
  const [following, setFollowing] = createSignal(true)
  const [status, setStatus] = createSignal<SessionStatus>(completed ? { type: "idle" } : { type: "busy" })
  const [view, setView] = createSignal(emptyTimelineView())
  const map = createMemo(() => ({ a1: parts(), u1: [part("user-text", "text", "问题")] }))
  const turn = createMemo(() => conversationTurns([user, assistant(done())], map(), { status: status() })[0])
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
  it("has one status before content and independent thought details", () => {
    const { container, setParts } = setup()
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1)
    expect(container.querySelector('[role="status"]')?.textContent).toBe("等待响应")
    setParts([part("r1", "reasoning", "思考原文")])
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1)
    expect(container.querySelector(".reasoning-inline")).toBeNull()
    ;(container.querySelector(".work-group > .work-head") as HTMLButtonElement).click()
    expect(container.querySelector(".reasoning-inline")?.textContent).toContain("思考原文")
  })
  it("preserves prose nodes and detail expansion as the answer grows", () => {
    const { container, setParts } = setup([part("p1", "text", "先检查"), tool])
    const prose = container.querySelector('[data-entry-key="a1:p1"]')
    ;(container.querySelector(".work-group > .work-head") as HTMLButtonElement).click()
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
    ;(container.querySelector(".work-group > .work-head") as HTMLButtonElement).click()
    expect(container.querySelector(".step-error-preview")?.textContent).toContain("read failed")
    expect(container.querySelector('[role="status"]')?.textContent).toContain("正在思考")
  })
  it("separates activity groups with prose and expands only the selected group", () => {
    const nextTool: Part = { ...tool, id: "t2", callID: "t2", tool: "bash", state: { status: "completed", input: { command: "bun run build" }, output: "built" } }
    const { container } = setup([
      part("r0", "reasoning", "先确认需求"), part("p1", "text", "先检查文件"),
      tool, part("r1", "reasoning", "检查结果"), part("p2", "text", "然后构建"), nextTool,
      part("p3", "text", "最终结论"),
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
    expect([...container.querySelectorAll(".work-step-head")].map((head) => head.textContent)).toEqual([expect.stringContaining("Read app.ts"), expect.stringContaining("Thought")])
    expect(container.querySelector(".tool-details")).toBeNull()
    expect(container.querySelector(".step-state")).toBeNull()
  })
  it("keeps the current group stable as new operations arrive, then moves status to the prose tail", () => {
    const { container, setParts } = setup([part("p1", "text", "先检查"), tool])
    const group = container.querySelector(".work-group")
    ;(container.querySelector(".work-group > .work-head") as HTMLButtonElement).click()
    setParts([part("p1", "text", "先检查"), tool, { ...tool, id: "t2", callID: "t2", state: { status: "running", input: { filePath: "other.ts" } } } as Part])
    expect(container.querySelector(".work-group")).toBe(group)
    expect(container.querySelector(".work-group.open")).toBe(group)
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1)
    expect(container.querySelector('.work-group [role="status"]')).toBeTruthy()
    setParts([part("p1", "text", "先检查"), tool, part("p2", "text", "继续处理")])
    expect(container.querySelector(".work-group")).toBe(group)
    expect(container.querySelector('.work-group [role="status"]')).toBeNull()
    expect(container.querySelector('.turn-status [role="status"]')?.textContent).toContain("正在输出回复")
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
    const { container } = setup([thought])
    expect(container.querySelector('.work-group > .work-head')?.textContent).toContain("Thought 2s")
    expect(container.querySelector('[role="status"]')?.textContent).toBe("正在继续处理")
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1)
  })
  it("preserves inspected reasoning and text selection when tools join its group", () => {
    const thought = part("r1", "reasoning", "原来的思考内容")
    const { container, setParts } = setup([thought])
    ;(container.querySelector(".work-group > .work-head") as HTMLButtonElement).click()
    const body = container.querySelector(".reasoning-inline")!
    const node = body.querySelector("p")!.firstChild!
    const range = document.createRange()
    range.setStart(node, 0); range.setEnd(node, 3)
    window.getSelection()!.addRange(range)
    setParts([thought, tool])
    expect(container.querySelector(".reasoning-inline")).toBe(body)
    expect(window.getSelection()!.toString()).toBe("原来的")
    expect(container.querySelectorAll(".work-group.open")).toHaveLength(1)
    window.getSelection()!.removeAllRanges()
    ;(container.querySelector('[data-entry-key="a1:r1"] .work-step-head') as HTMLButtonElement).click()
    expect(container.querySelector(".reasoning-inline")).toBeNull()
  })
})
