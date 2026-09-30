import { afterEach, describe, expect, it, vi } from "vitest"
import { createSignal, type JSX } from "solid-js"
import { render } from "solid-js/web"
import { StoreProviders } from "../store/ctx"
import type { ChromeApi, ModelApi, ProjectApi, RuntimeApi } from "../store/contracts"
import type { AssistantMessage, Part, ReasoningPart, TextPart, ToolPart } from "../lib/types"
import { ChatTurnView } from "./MessagePart"
import { WorkGroup } from "./WorkGroup"

type Connection = "connected" | "disconnected"

const cleanups: Array<() => void> = []

function mount(ui: () => JSX.Element, connection: Connection = "connected") {
  const projects = { connection: () => connection } as unknown as ProjectApi
  const models = { nameFor: () => "mock-model" } as unknown as ModelApi
  const runtime = { pendingQuestions: () => [], busy: () => false } as unknown as RuntimeApi
  const chrome = {} as ChromeApi
  const container = document.createElement("div")
  document.body.appendChild(container)
  const dispose = render(
    () => (
      <StoreProviders projects={projects} models={models} runtime={runtime} chrome={chrome}>
        {ui()}
      </StoreProviders>
    ),
    container,
  )
  cleanups.push(() => {
    dispose()
    container.remove()
  })
  return container
}

afterEach(() => {
  vi.useRealTimers()
  while (cleanups.length) cleanups.pop()?.()
})

const assistant = (patch: Partial<AssistantMessage> = {}): AssistantMessage => ({
  id: "msg_1",
  sessionID: "ses_1",
  role: "assistant",
  time: { created: 1_000 },
  ...patch,
})

const reasoning = (text: string, end?: number): ReasoningPart => ({
  id: "prt_r1",
  sessionID: "ses_1",
  messageID: "msg_1",
  type: "reasoning",
  text,
  time: end ? { start: 1_000, end } : { start: 1_000 },
})

const tool = (): ToolPart => ({
  id: "prt_t1",
  sessionID: "ses_1",
  messageID: "msg_1",
  type: "tool",
  callID: "call_1",
  tool: "read",
  state: {
    status: "completed",
    input: { path: "src/app.ts" },
    output: "file contents",
    time: { start: 1_000, end: 2_000 },
  },
})

const text = (value: string): TextPart => ({
  id: "prt_x1",
  sessionID: "ses_1",
  messageID: "msg_1",
  type: "text",
  text: value,
})

function childOrder(container: HTMLElement) {
  const group = container.querySelector(".work-group")
  return [...(group?.children ?? [])].map((el) => el.className)
}

describe("live thought expansion", () => {
  it("keeps Planning next moves inert until reasoning arrives, then expands the thought below that row", async () => {
    const [map, setMap] = createSignal<Record<string, Part[]>>({})
    const container = mount(() => (
      <ChatTurnView turn={{ assistants: [assistant()] }} partsByMessage={map()} live />
    ))

    const statusHead = container.querySelector(".work-status-head") as HTMLButtonElement | null
    expect(statusHead).toBeTruthy()
    expect(statusHead?.disabled).toBe(true)
    expect(statusHead?.textContent).toContain("Planning next moves")
    expect(statusHead?.querySelector(".work-summary-caret")).toBeFalsy()
    statusHead?.click()
    expect(container.querySelector(".work-steps")).toBeFalsy()

    setMap({ msg_1: [reasoning("step one")] })
    await new Promise((resolve) => setTimeout(resolve, 750))
    const thoughtHead = container.querySelector(".work-status-head") as HTMLButtonElement | null
    expect(thoughtHead?.disabled).toBe(false)
    expect(thoughtHead?.textContent).toContain("Thinking")
    expect(thoughtHead?.querySelector(".work-summary-caret")).toBeTruthy()
    const group = container.querySelector(".work-group")
    thoughtHead?.click()
    expect(container.querySelector(".work-group")).toBe(group)
    const order = childOrder(container)
    expect(order.indexOf("work-status-head")).toBeGreaterThanOrEqual(0)
    expect(order.indexOf("work-steps")).toBeGreaterThan(order.indexOf("work-status-head"))
    expect(container.querySelector(".reasoning-inline")?.textContent).toContain("step one")

    setMap({ msg_1: [reasoning("step one, then two")] })
    expect(container.querySelector(".reasoning-inline")?.textContent).toContain("step one, then two")
  })

  it("expands a lone finished Thought below the Thought row", () => {
    const container = mount(() => <WorkGroup parts={[reasoning("considered the options", 3_000)]} live />)
    const head = container.querySelector(".work-status-head") as HTMLButtonElement | null
    expect(container.querySelector(".work-head")).toBeFalsy()
    expect(head?.textContent).toContain("Thought")
    expect(head?.disabled).toBe(false)
    expect(head?.querySelector(".work-summary-caret")).toBeTruthy()
    head?.click()
    const order = childOrder(container)
    expect(order.indexOf("work-status-head")).toBe(0)
    expect(order.indexOf("work-steps")).toBe(1)
    expect(container.querySelector(".reasoning-inline")?.textContent).toContain("considered the options")
  })

  it("keeps the panel open when the answer starts streaming and collapses only when the turn ends", () => {
    const [map, setMap] = createSignal<Record<string, Part[]>>({ msg_1: [reasoning("step one")] })
    const [live, setLive] = createSignal(true)
    const container = mount(() => (
      <ChatTurnView turn={{ assistants: [assistant()] }} partsByMessage={map()} live={live()} />
    ))

    const statusHead = container.querySelector(".work-status-head") as HTMLButtonElement | null
    statusHead?.click()
    const order = childOrder(container)
    expect(order.indexOf("work-steps")).toBeGreaterThan(order.indexOf("work-status-head"))
    expect(container.querySelector(".reasoning-inline")?.textContent).toContain("step one")

    setMap({ msg_1: [reasoning("step one", 3_000), text("Here is the answer.")] })
    expect(container.querySelector(".work-steps")).toBeTruthy()
    expect(container.querySelector(".reasoning-inline")?.textContent).toContain("step one")
    expect(container.querySelector(".work-status-head")).toBeFalsy()
    expect(container.querySelector(".work-head")?.textContent).toContain("Thought")

    setLive(false)
    expect(container.querySelector(".work-steps")).toBeFalsy()
    expect(container.querySelector(".worked-for")).toBeFalsy()
    expect(container.querySelector(".work-head")?.textContent).toContain("Thought")

    const head = container.querySelector(".work-head") as HTMLButtonElement | null
    head?.click()
    expect(container.querySelector(".reasoning-inline")?.textContent).toContain("step one")
  })

  it("keeps the live status line a pure indicator when the summary head is present", () => {
    const container = mount(() => <WorkGroup parts={[tool()]} live />)

    const head = container.querySelector(".work-head") as HTMLButtonElement | null
    expect(head?.textContent).toContain("Explored")
    expect(head?.querySelector(".work-summary-caret")).toBeTruthy()

    const statusHead = container.querySelector(".work-status-head") as HTMLButtonElement | null
    expect(statusHead).toBeTruthy()
    expect(statusHead?.textContent).toContain("Planning next moves")
    expect(statusHead?.disabled).toBe(true)
    expect(statusHead?.querySelector(".work-summary-caret")).toBeFalsy()

    statusHead?.click()
    expect(container.querySelector(".work-steps")).toBeFalsy()

    head?.click()
    const order = childOrder(container)
    expect(order.indexOf("work-steps")).toBeGreaterThanOrEqual(0)
    expect(order.indexOf("work-status-head")).toBeGreaterThan(order.indexOf("work-steps"))
    expect(container.querySelector(".work-steps")).toBeTruthy()
  })

  it("mounts an inert Planning next moves line before any assistant message exists", () => {
    const container = mount(() => <ChatTurnView turn={{ assistants: [] }} partsByMessage={{}} live />)
    const statusHead = container.querySelector(".work-status-head") as HTMLButtonElement | null
    expect(statusHead).toBeTruthy()
    expect(statusHead?.textContent).toContain("Planning next moves")
    expect(statusHead?.disabled).toBe(true)
    expect(statusHead?.querySelector(".work-summary-caret")).toBeFalsy()
    statusHead?.click()
    expect(container.querySelector(".work-group")?.classList.contains("open")).toBe(false)
  })

  it("keeps the reconnecting placeholder inert", () => {
    const container = mount(() => <WorkGroup parts={[]} live />, "disconnected")
    const statusHead = container.querySelector(".work-status-head") as HTMLButtonElement | null
    expect(statusHead).toBeTruthy()
    expect(statusHead?.disabled).toBe(true)
    expect(statusHead?.querySelector(".work-summary-caret")).toBeFalsy()
  })
})

describe("settled thought rows", () => {
  it("shows a single Thought head directly for a thought-only turn and expands it", () => {
    const container = mount(() => (
      <ChatTurnView
        turn={{ assistants: [assistant({ time: { created: 1_000, completed: 9_000 } })] }}
        partsByMessage={{ msg_1: [reasoning("considered the options", 3_000), text("Answer.")] }}
        live={false}
      />
    ))

    expect(container.querySelector(".worked-for")).toBeFalsy()
    const head = container.querySelector(".work-head") as HTMLButtonElement | null
    expect(head?.textContent).toContain("Thought")
    expect(head?.querySelector(".work-summary-caret")).toBeTruthy()
    head?.click()
    const order = childOrder(container)
    expect(order.indexOf("work-head")).toBe(0)
    expect(order.indexOf("work-steps")).toBe(1)
    expect(container.querySelector(".reasoning-inline")?.textContent).toContain("considered the options")
  })

  it("gives each step row inside a mixed work group a caret and expands the thought step", () => {
    const container = mount(() => (
      <ChatTurnView
        turn={{ assistants: [assistant({ time: { created: 1_000, completed: 9_000 } })] }}
        partsByMessage={{
          msg_1: [reasoning("considered the options", 3_000), tool(), text("Answer.")],
        }}
        live={false}
      />
    ))

    expect(container.querySelector(".worked-for")).toBeTruthy()
    const wrapper = container.querySelector(".worked-for > .work-head") as HTMLButtonElement | null
    wrapper?.click()

    const group = container.querySelector(".worked-for .work-group .work-head") as HTMLButtonElement | null
    expect(group?.textContent).toContain("Explored")
    group?.click()

    const steps = container.querySelectorAll(".work-step")
    expect(steps.length).toBe(2)
    for (const step of steps) {
      expect(step.querySelector(".work-step-caret")).toBeTruthy()
    }

    const thoughtHead = steps[0]?.querySelector(".work-step-head") as HTMLButtonElement | null
    expect(thoughtHead?.textContent).toContain("Thought")
    thoughtHead?.click()
    expect(steps[0]?.classList.contains("open")).toBe(true)
    expect(container.querySelector(".reasoning-inline")?.textContent).toContain("considered the options")
  })
})
