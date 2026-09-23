import { afterEach, describe, expect, it } from "vitest"
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

describe("live thought expansion", () => {
  it("keeps the Thinking head clickable before any reasoning text arrives and streams into the open panel", () => {
    const [map, setMap] = createSignal<Record<string, Part[]>>({})
    const container = mount(() => (
      <ChatTurnView turn={{ assistants: [assistant()] }} partsByMessage={map()} live />
    ))

    const statusHead = container.querySelector(".work-status-head") as HTMLButtonElement | null
    expect(statusHead).toBeTruthy()
    expect(statusHead?.disabled).toBe(false)
    expect(statusHead?.textContent).toContain("Thinking")
    expect(statusHead?.querySelector(".work-summary-caret")).toBeTruthy()

    const group = container.querySelector(".work-group")
    statusHead?.click()
    expect(container.querySelector(".work-steps")).toBeTruthy()

    setMap({ msg_1: [reasoning("step one")] })
    expect(container.querySelector(".work-group")).toBe(group)
    expect(container.querySelector(".work-steps")).toBeTruthy()
    expect(container.querySelector(".reasoning-inline")?.textContent).toContain("step one")

    setMap({ msg_1: [reasoning("step one, then two")] })
    expect(container.querySelector(".reasoning-inline")?.textContent).toContain("step one, then two")
  })

  it("keeps the panel open when the answer starts streaming and collapses only when the turn ends", () => {
    const [map, setMap] = createSignal<Record<string, Part[]>>({ msg_1: [reasoning("step one")] })
    const [live, setLive] = createSignal(true)
    const container = mount(() => (
      <ChatTurnView turn={{ assistants: [assistant()] }} partsByMessage={map()} live={live()} />
    ))

    const statusHead = container.querySelector(".work-status-head") as HTMLButtonElement | null
    statusHead?.click()
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

  it("mounts the live head for a turn without assistant messages yet", () => {
    const container = mount(() => <ChatTurnView turn={{ assistants: [] }} partsByMessage={{}} live />)
    const statusHead = container.querySelector(".work-status-head") as HTMLButtonElement | null
    expect(statusHead).toBeTruthy()
    expect(statusHead?.disabled).toBe(false)
    statusHead?.click()
    expect(container.querySelector(".work-group")?.classList.contains("open")).toBe(true)
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
