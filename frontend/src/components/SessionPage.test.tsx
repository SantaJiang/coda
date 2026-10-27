import { batch, createSignal } from "solid-js"
import { render } from "solid-js/web"
import { afterEach, expect, it, vi } from "vitest"
import { StoreProviders } from "../store/ctx"
import type { ChromeApi, ModelApi, ProjectApi, RuntimeApi } from "../store/contracts"
import type { Message, Session } from "../lib/types"
import type { TerminalClient } from "../lib/terminal-client"
import type { TerminalInfo } from "../lib/terminal-contracts"
import { SessionPage } from "./SessionPage"

vi.mock("./TerminalPanel", () => ({ default: () => <div class="terminal-panel" /> }))

vi.mock("./MessageTimeline", () => ({ MessageTimeline: () => <div class="timeline-region" /> }))
vi.mock("./ContextBar", () => ({ ContextBar: () => <div /> }))
vi.mock("./QuestionDock", () => ({ QuestionDock: () => null }))
vi.mock("./PermissionDock", () => ({ PermissionDock: () => null }))
vi.mock("./QueueDock", () => ({ QueueDock: () => null }))
vi.mock("./ComposerPlus", () => ({ ComposerPlus: () => null }))
vi.mock("./ModelMenu", () => ({ ModelMenu: () => null }))
vi.mock("./VariantMenu", () => ({ VariantMenu: () => null }))
vi.mock("./PermissionMenu", () => ({ PermissionMenu: () => null }))
vi.mock("./WindowChrome", () => ({ ChromeDrag: (props: { children: unknown }) => props.children, WindowControls: () => null }))
let dispose: (() => void) | undefined
afterEach(() => { dispose?.(); document.body.replaceChildren(); localStorage.clear(); vi.unstubAllGlobals() })

const frames = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

it("keeps the same focused composer across draft admission, stop, and shortcut resend", async () => {
  const [session, setSession] = createSignal({ id: "draft:one", title: "新会话", localDraft: true } as Session)
  const [messages, setMessages] = createSignal<Message[]>([])
  const [text, setText] = createSignal("first request")
  const [busy, setBusy] = createSignal(false)
  const send = vi.fn(async () => batch(() => {
    setSession({ id: "real", title: "新会话" } as Session)
    setMessages([{ id: "user", role: "user", sessionID: "real", time: { created: Date.now() } } as Message])
    setText("")
    setBusy(true)
  }))
  const runtime = {
    messages, composer: text, setComposer: setText, busy, hasPlan: () => false,
    attachments: () => [], attachmentsLoading: () => false, blocked: () => false, stopping: () => false,
    send, abort: async () => { setBusy(false); setSession((item) => ({ ...item, title: "stopped" })) },
  } as unknown as RuntimeApi
  const host = document.createElement("div")
  document.body.append(host)
  dispose = render(() => <StoreProviders
    projects={{ selectedSession: session, selectedSessionId: () => session().id, selectedProject: () => ({ path: "/tmp/stable-composer" }), error: () => "" } as ProjectApi}
    runtime={runtime} models={{ selectedModel: () => ({ name: "model" }) } as ModelApi}
    chrome={{ planPanelDismissed: () => false, overlayOpen: () => false, planMode: () => false, sendShortcut: () => "mod-enter" } as ChromeApi}
    terminals={{ list: async () => ({ backendID: "test", items: [] }) } as unknown as TerminalClient}>
    <SessionPage />
  </StoreProviders>, host)
  const area = host.querySelector<HTMLTextAreaElement>(".composer textarea")!
  expect(host.querySelector(".draft-composer-region")).not.toBeNull()
  area.focus()
  area.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true }))
  expect(send).toHaveBeenCalledOnce()
  expect(host.querySelector(".draft-composer-region")).toBeNull()
  expect(host.querySelector(".composer textarea")).toBe(area)
  expect(host.querySelectorAll(".composer")).toHaveLength(1)
  expect(document.activeElement).toBe(area)
  await runtime.abort()
  setText("new request")
  await new Promise<void>((resolve) => queueMicrotask(resolve))
  area.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true }))
  expect(send).toHaveBeenCalledTimes(2)
  expect(host.querySelector(".composer textarea")).toBe(area)
  expect(document.activeElement).toBe(area)
})

function terminalSession() {
  const now = Date.now()
  const info: TerminalInfo = {
    id: "term",
    sessionID: "aside-real",
    rootSessionID: "aside-real",
    command: "bun test",
    cwd: "/tmp",
    startedAt: now - 20_000,
    lastOutputAt: now,
    status: "running",
    cursor: 5,
    baseCursor: 0,
  }
  const client = {
    list: async () => ({ backendID: "test", items: [info] }),
    log: async () => ({ data: btoa("hello"), start: 0, cursor: 5, baseCursor: 0, endCursor: 5, truncated: false, status: "running" as const }),
    subscribe: () => () => {},
    control: async () => {},
  } as TerminalClient
  const runtime = {
    messages: () => [], composer: () => "", setComposer: () => {}, busy: () => false, hasPlan: () => false, todos: () => [],
    attachments: () => [], attachmentsLoading: () => false, blocked: () => false, stopping: () => false,
    send: async () => {}, abort: async () => {},
  } as unknown as RuntimeApi
  const host = document.createElement("div")
  document.body.append(host)
  dispose = render(() => <StoreProviders
    projects={{ selectedSession: () => ({ id: "aside-real", title: "会话" } as Session), selectedSessionId: () => "aside-real", selectedProject: () => ({ path: `/tmp/aside-${now}` }), error: () => "" } as ProjectApi}
    runtime={runtime} models={{ selectedModel: () => ({ name: "model" }) } as ModelApi}
    chrome={{ planPanelDismissed: () => false, overlayOpen: () => false, planMode: () => false, sendShortcut: () => "mod-enter", closePlanPanel: () => {} } as ChromeApi}
    terminals={client}>
    <SessionPage />
  </StoreProviders>, host)
  return host
}

it("slides the terminal aside open and keeps it mounted until the close transition ends", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }))
  const host = terminalSession()
  await flush()
  const button = host.querySelector<HTMLButtonElement>(".terminal-dock-button")
  expect(button).not.toBeNull()
  button!.click()
  const aside = host.querySelector(".terminal-aside")
  expect(aside).not.toBeNull()
  expect(aside!.classList.contains("is-open")).toBe(false)
  await frames()
  expect(aside!.classList.contains("is-open")).toBe(true)
  button!.click()
  expect(host.querySelector(".terminal-aside")).toBe(aside)
  expect(aside!.classList.contains("is-open")).toBe(false)
  aside!.dispatchEvent(new TransitionEvent("transitionend", { propertyName: "width" }))
  expect(host.querySelector(".terminal-aside")).toBeNull()
})

it("opens and closes the terminal aside immediately when motion is reduced", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }))
  const host = terminalSession()
  await flush()
  const button = host.querySelector<HTMLButtonElement>(".terminal-dock-button")!
  button.click()
  const aside = host.querySelector(".terminal-aside")
  expect(aside?.classList.contains("is-open")).toBe(true)
  host.querySelector<HTMLButtonElement>(".terminal-dock-button")!.click()
  expect(host.querySelector(".terminal-aside")).toBeNull()
})
