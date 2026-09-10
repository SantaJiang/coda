import { describe, expect, it, vi } from "vitest"
import { createStore } from "solid-js/store"
import type { AgentClient } from "./ports"
import { applySessionPermission, autoReplyPending } from "./permission-sync"
import { initialState, type AppState } from "./state"
import type { StoreHandle } from "./handle"

function stubClient(overrides: Partial<AgentClient> = {}): AgentClient {
  return {
    healthcheck: vi.fn(),
    listProviders: vi.fn(),
    patchGlobalConfig: vi.fn(),
    listSessions: vi.fn(),
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
    replyPermission: vi.fn(),
    replyQuestion: vi.fn(),
    rejectQuestion: vi.fn(),
    getVcs: vi.fn(),
    ...overrides,
  }
}

describe("permission-sync", () => {
  it("pushes the current mode ruleset through the injected client", async () => {
    const updateSessionPermission = vi.fn().mockResolvedValue(undefined)
    const [state, setState] = createStore<AppState>({
      ...structuredClone(initialState),
      permissionMode: "ask",
      selectedProjectId: "p1",
      projects: [{ id: "p1", name: "app", path: "/tmp/app", expanded: true }],
    })
    const handle: StoreHandle = {
      state,
      setState,
      client: stubClient({ updateSessionPermission }),
    }
    await applySessionPermission(handle, "/tmp/app", "s1")
    expect(updateSessionPermission).toHaveBeenCalledWith("/tmp/app", "s1", expect.any(Array))
  })

  it("auto-replies matching pending permissions via the injected client", async () => {
    const replyPermission = vi.fn().mockResolvedValue(true)
    const [state, setState] = createStore<AppState>({
      ...structuredClone(initialState),
      selectedProjectId: "p1",
      projects: [{ id: "p1", name: "app", path: "/tmp/app", expanded: true }],
      permissions: {
        p1: { id: "p1", sessionID: "s1", permission: "edit", patterns: ["*"] },
      },
    })
    const handle: StoreHandle = {
      state,
      setState,
      client: stubClient({ replyPermission }),
    }
    await autoReplyPending(handle, "allow", "s1")
    expect(replyPermission).toHaveBeenCalledWith("/tmp/app", "p1", "always")
    expect(state.permissions.p1).toBeUndefined()
  })
})
