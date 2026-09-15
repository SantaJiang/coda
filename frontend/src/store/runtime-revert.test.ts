import { describe, expect, it, vi } from "vitest"
import { createStore } from "solid-js/store"
import type { AgentClient } from "./ports"
import { createRuntimeSlice } from "./runtime-slice"
import { initialState, type AppState } from "./state"
import type { StoreHandle } from "./handle"
import type { Message, Session } from "../lib/types"

function stubClient(overrides: Partial<AgentClient> = {}): AgentClient {
  return {
    healthcheck: vi.fn(),
    listProviders: vi.fn(),
    patchGlobalConfig: vi.fn(),
    listProjects: vi.fn(),
    listSessions: vi.fn(),
    listSessionStatuses: vi.fn(),
    listMessages: vi.fn(),
    listTodos: vi.fn(),
    listPermissions: vi.fn(),
    listQuestions: vi.fn(),
    createSession: vi.fn(),
    updateSessionTitle: vi.fn(),
    deleteSession: vi.fn(),
    updateSessionPermission: vi.fn(),
    promptAsync: vi.fn(),
    abortSession: vi.fn(),
    revertSession: vi.fn(),
    replyPermission: vi.fn(),
    replyQuestion: vi.fn(),
    rejectQuestion: vi.fn(),
    getVcs: vi.fn(),
    ...overrides,
  }
}

function userMessage(id: string): Message {
  return { id, sessionID: "s1", role: "user", time: { created: 1 } }
}

function setup(revertSession: AgentClient["revertSession"]) {
  const session: Session = { id: "s1", directory: "/tmp/app", title: "会话", time: { created: 1, updated: 1 } }
  const [state, setState] = createStore<AppState>({
    ...structuredClone(initialState),
    selectedProjectId: "p1",
    selectedSessionId: "s1",
    draft: false,
    projects: [{ id: "p1", name: "app", path: "/tmp/app", expanded: true }],
    sessionsByProject: { "/tmp/app": [session] },
    messages: { s1: [userMessage("m1"), userMessage("m2"), userMessage("m3")] },
    parts: {
      m2: [
        { id: "p1", sessionID: "s1", messageID: "m2", type: "text", text: "修复登录" },
        {
          id: "p2",
          sessionID: "s1",
          messageID: "m2",
          type: "file",
          mime: "text/plain",
          filename: "notes.md",
          url: "file:///tmp/notes.md",
        },
      ],
    },
  })
  const handle: StoreHandle = { state, setState, client: stubClient({ revertSession }) }
  const runtime = createRuntimeSlice(handle, { skipQueueFlush: {}, sendAfterIdle: {}, flushing: {} })
  return { state, setState, runtime, session }
}

describe("runtime.revertToMessage", () => {
  it("reverts on the backend, refills the draft, and hides reverted messages", async () => {
    const revertSession = vi.fn()
    const { runtime, session } = setup(revertSession)
    revertSession.mockResolvedValue({ ...session, revert: { messageID: "m2" } })

    await runtime.revertToMessage("m2")

    expect(revertSession).toHaveBeenCalledWith("/tmp/app", "s1", "m2")
    expect(runtime.composer()).toBe("修复登录")
    expect(runtime.attachments()).toHaveLength(1)
    expect(runtime.attachments()[0]).toMatchObject({ filename: "notes.md", kind: "file" })
    expect(runtime.messages().map((message) => message.id)).toEqual(["m1"])
  })

  it("reports an error and keeps the draft when the backend rejects", async () => {
    const revertSession = vi.fn().mockRejectedValue(new Error("session is busy"))
    const { state, runtime } = setup(revertSession)

    await runtime.revertToMessage("m2")

    expect(state.error).toBe("session is busy")
    expect(runtime.composer()).toBe("")
    expect(runtime.messages().map((message) => message.id)).toEqual(["m1", "m2", "m3"])
  })

  it("does nothing while the session is busy", async () => {
    const revertSession = vi.fn()
    const { setState, runtime } = setup(revertSession)
    setState("status", "s1", { type: "busy" })

    await runtime.revertToMessage("m2")

    expect(revertSession).not.toHaveBeenCalled()
  })
})
