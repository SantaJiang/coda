import { describe, expect, it, vi } from "vitest"
import { createStore } from "solid-js/store"
import type { AgentClient } from "./ports"
import { createRuntimeSlice } from "./runtime-slice"
import { initialState, type AppState, type QueuedMessage } from "./state"
import type { StoreHandle } from "./handle"
import type { Session } from "../lib/types"

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

const session = (id: string, directory: string): Session => ({
  id,
  directory,
  title: id,
  time: { created: 1, updated: 1 },
})

const queued = (directory: string, text = "background"): QueuedMessage => ({
  id: "q1",
  text,
  attachments: [],
  agent: "build",
  model: { providerID: "openai", modelID: "gpt" },
  variant: null,
  directory,
})

function setup(overrides: Partial<AgentClient> = {}, listed = true) {
  const [state, setState] = createStore<AppState>({
    ...structuredClone(initialState),
    selectedProjectId: "p2",
    selectedSessionId: "s2",
    draft: false,
    projects: [
      { id: "p1", name: "app", path: "/tmp/app", expanded: true },
      { id: "p2", name: "other", path: "/tmp/other", expanded: true },
    ],
    sessionsByProject: {
      ...(listed ? { "/tmp/app": [session("s1", "/tmp/app")] } : {}),
      "/tmp/other": [session("s2", "/tmp/other")],
    },
    status: { s1: { type: "idle" } },
    queuedBySession: { s1: [queued("/tmp/app")] },
  })
  const handle: StoreHandle = { state, setState, client: stubClient(overrides) }
  const runtime = createRuntimeSlice(handle, { skipQueueFlush: {}, sendAfterIdle: {}, flushing: {} })
  return { state, setState, runtime, client: handle.client }
}

describe("runtime.flushQueue for background sessions", () => {
  it("sends the queued message of a session that is not selected", async () => {
    const promptAsync = vi.fn()
    const updateSessionPermission = vi.fn()
    const { runtime, state, client } = setup({ promptAsync, updateSessionPermission })

    await runtime.flushQueue("s1")

    expect(client.promptAsync).toHaveBeenCalledWith(
      "/tmp/app",
      "s1",
      expect.objectContaining({ text: "background" }),
    )
    expect(client.updateSessionPermission).toHaveBeenCalledWith("/tmp/app", "s1", expect.any(Array))
    expect(state.queuedBySession.s1).toEqual([])
    expect(state.selectedSessionId).toBe("s2")
  })

  it("resolves the directory from the queued item when the session list is not loaded", async () => {
    const { runtime, client } = setup({ promptAsync: vi.fn() }, false)

    await runtime.flushQueue("s1")

    expect(client.promptAsync).toHaveBeenCalledWith("/tmp/app", "s1", expect.anything())
  })

  it("keeps the message queued when the backend rejects it", async () => {
    const { runtime, state } = setup({ promptAsync: vi.fn().mockRejectedValue(new Error("boom")) })

    await runtime.flushQueue("s1")

    expect(state.queuedBySession.s1?.map((item) => item.id)).toEqual(["q1"])
  })

  it("does not send while the session is still busy", async () => {
    const { runtime, state, setState, client } = setup({ promptAsync: vi.fn() })
    setState("status", "s1", { type: "busy" })

    await runtime.flushQueue("s1")

    expect(client.promptAsync).not.toHaveBeenCalled()
    expect(state.queuedBySession.s1?.map((item) => item.id)).toEqual(["q1"])
  })
})

it("reuses the failed queued request identity on a later retry", async () => {
  const { runtime, state, client } = setup({
    promptAsync: vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined),
    listMessages: vi.fn().mockResolvedValue([]),
  })
  await runtime.flushQueue("s1")
  const firstID = state.messages.s1[0].id
  expect(state.queuedBySession.s1).toHaveLength(1)
  await runtime.flushQueue("s1")
  expect(state.messages.s1).toHaveLength(1)
  expect(client.promptAsync).toHaveBeenLastCalledWith("/tmp/app", "s1", expect.objectContaining({ messageID: firstID }))
})
