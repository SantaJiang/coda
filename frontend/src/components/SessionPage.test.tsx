import { batch, createSignal } from "solid-js"
import { render } from "solid-js/web"
import { afterEach, expect, it, vi } from "vitest"
import { StoreProviders } from "../store/ctx"
import type { ChromeApi, ModelApi, ProjectApi, RuntimeApi } from "../store/contracts"
import type { Message, Session } from "../lib/types"
import type { TerminalClient } from "../lib/terminal-client"
import { SessionPage } from "./SessionPage"

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
afterEach(() => { dispose?.(); document.body.replaceChildren(); localStorage.clear() })

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
