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
    stageRevertSession: vi.fn(),
    commitRevertSession: vi.fn(),
    clearRevertSession: vi.fn(),
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

function setup(revertSession: AgentClient["revertSession"], extra: Partial<AgentClient> = {}) {
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
  const handle: StoreHandle = { state, setState, client: stubClient({ revertSession, ...extra }) }
  const runtime = createRuntimeSlice(handle, { skipQueueFlush: {}, sendAfterIdle: {}, flushing: {} })
  return { state, setState, runtime, session }
}

describe("runtime.revertToMessage", () => {
  it("reverts on the backend, refills the draft, and cuts the timeline at the question", async () => {
    const revertSession = vi.fn()
    const { state, runtime, session } = setup(revertSession)
    // The backend deletes the boundary message and clears its revert marker.
    revertSession.mockResolvedValue({ ...session, revert: null })

    await runtime.revertToMessage("m2")

    expect(revertSession).toHaveBeenCalledWith("/tmp/app", "s1", "m2", true)
    expect(runtime.composer()).toBe("修复登录")
    expect(runtime.attachments()).toHaveLength(1)
    expect(runtime.attachments()[0]).toMatchObject({ filename: "notes.md", kind: "file" })
    expect(runtime.messages().map((message) => message.id)).toEqual(["m1"])
    expect(state.parts.m2).toBeUndefined()
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

  it("stages without files and hides the timeline until commit", async () => {
    const stageRevertSession = vi.fn(async () => ({ ...setupSession, revert: { messageID: "m2" } }))
    const { state, runtime, setState } = setup(vi.fn(), { stageRevertSession })
    setState("sessionsByProject", "/tmp/app", (list = []) => list.map((item) => item.id === "s1" ? { ...item, revert: { messageID: "m2" } } : item))

    await runtime.stageRevertToMessage("m2", false)

    expect(stageRevertSession).toHaveBeenCalledWith("/tmp/app", "s1", "m2", false)
    expect(runtime.messages().map((message) => message.id)).toEqual(["m1"])
    expect(state.parts.m2).toBeDefined()
  })

  it("commits and clears a staged revert", async () => {
    const commitRevertSession = vi.fn(async () => ({ ...setupSession, revert: null }))
    const clearRevertSession = vi.fn(async () => ({ ...setupSession, revert: null }))
    const { runtime, setState } = setup(vi.fn(), { commitRevertSession, clearRevertSession })
    setState("sessionsByProject", "/tmp/app", (list = []) => list.map((item) => item.id === "s1" ? { ...item, revert: { messageID: "m2" } } : item))

    await runtime.commitRevert()
    expect(commitRevertSession).toHaveBeenCalledWith("/tmp/app", "s1")
    expect(runtime.messages().map((message) => message.id)).toEqual(["m1"])

    // The commit above removed m2/m3 from the timeline; restore them to test clear on its own.
    setState("messages", "s1", [userMessage("m1"), userMessage("m2"), userMessage("m3")])
    setState("sessionsByProject", "/tmp/app", (list = []) => list.map((item) => item.id === "s1" ? { ...item, revert: { messageID: "m2" } } : item))
    await runtime.clearRevert()
    expect(clearRevertSession).toHaveBeenCalledWith("/tmp/app", "s1")
    expect(runtime.messages().map((message) => message.id)).toEqual(["m1", "m2", "m3"])
  })
})

const setupSession: Session = { id: "s1", directory: "/tmp/app", title: "会话", time: { created: 1, updated: 1 } }
