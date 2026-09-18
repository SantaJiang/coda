import { describe, expect, it, vi } from "vitest"
import { createStore } from "solid-js/store"
import type { AgentClient } from "./ports"
import { createRuntimeSlice } from "./runtime-slice"
import { initialState, type AppState } from "./state"
import type { StoreHandle } from "./handle"
import type { Session } from "../lib/types"
import { createProjectSlice } from "./project-slice"

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

describe("runtime draft conversion", () => {
  it("turns a local draft into a backend session on send and drops the draft", async () => {
    const created: Session = {
      id: "s1",
      directory: "/tmp/app",
      title: "New session - now",
      time: { created: 10, updated: 10 },
    }
    const createSession = vi.fn().mockResolvedValue(created)
    const promptAsync = vi.fn().mockResolvedValue(undefined)
    const client = stubClient({ createSession, promptAsync, updateSessionPermission: vi.fn() })
    const [state, setState] = createStore<AppState>({
      ...structuredClone(initialState),
      selectedProjectId: "p1",
      selectedSessionId: "draft_1",
      draft: true,
      projects: [{ id: "p1", name: "app", path: "/tmp/app", expanded: true }],
      draftSessionsByProject: {
        "/tmp/app": [
          {
            id: "draft_1",
            directory: "/tmp/app",
            title: "帮我修 bug",
            localDraft: true,
            time: { created: 1, updated: 2 },
          },
        ],
      },
      drafts: { "session:draft_1": { composer: "帮我修 bug", attachments: [] } },
      planModeBySession: { draft_1: true },
      configuredModels: [
        {
          id: "c1",
          name: "gpt",
          providerID: "openai",
          providerName: "OpenAI",
          modelID: "gpt",
          baseURL: "https://api.openai.com",
          apiKey: "k",
        },
      ],
      selectedModelKey: "openai/gpt",
    })
    const handle: StoreHandle = { state, setState, client }
    const runtime = createRuntimeSlice(handle, { skipQueueFlush: {}, sendAfterIdle: {}, flushing: {} })

    await runtime.send()

    expect(createSession).toHaveBeenCalled()
    expect(promptAsync).toHaveBeenCalledWith(
      "/tmp/app",
      "s1",
      expect.objectContaining({ text: "帮我修 bug" }),
    )
    expect(state.selectedSessionId).toBe("s1")
    expect(state.draft).toBe(false)
    expect(state.draftSessionsByProject["/tmp/app"]).toEqual([])
    expect(state.sessionsByProject["/tmp/app"]?.some((item) => item.id === "s1")).toBe(true)
    expect(state.planModeBySession.s1).toBe(true)
    expect(state.planModeBySession.draft_1).toBeUndefined()
  })

  it("keeps composer on the backend session if prompt fails after create", async () => {
    const created: Session = {
      id: "s1",
      directory: "/tmp/app",
      title: "New session - now",
      time: { created: 10, updated: 10 },
    }
    const client = stubClient({
      createSession: vi.fn().mockResolvedValue(created),
      promptAsync: vi.fn().mockRejectedValue(new Error("boom")),
      updateSessionPermission: vi.fn(),
    })
    const [state, setState] = createStore<AppState>({
      ...structuredClone(initialState),
      selectedProjectId: "p1",
      selectedSessionId: "draft_1",
      draft: true,
      projects: [{ id: "p1", name: "app", path: "/tmp/app", expanded: true }],
      draftSessionsByProject: {
        "/tmp/app": [
          {
            id: "draft_1",
            directory: "/tmp/app",
            title: "帮我修 bug",
            localDraft: true,
            time: { created: 1, updated: 2 },
          },
        ],
      },
      drafts: { "session:draft_1": { composer: "帮我修 bug", attachments: [] } },
      configuredModels: [
        {
          id: "c1",
          name: "gpt",
          providerID: "openai",
          providerName: "OpenAI",
          modelID: "gpt",
          baseURL: "https://api.openai.com",
          apiKey: "k",
        },
      ],
      selectedModelKey: "openai/gpt",
    })
    const runtime = createRuntimeSlice(
      { state, setState, client },
      { skipQueueFlush: {}, sendAfterIdle: {}, flushing: {} },
    )

    await runtime.send()

    expect(state.selectedSessionId).toBe("s1")
    expect(state.drafts["session:s1"]?.composer).toBe("帮我修 bug")
    expect(state.draftSessionsByProject["/tmp/app"]).toEqual([])
    expect(state.error).toContain("boom")
  })

  it("materializes a phantom composer into a tree draft", () => {
    const [state, setState] = createStore<AppState>({
      ...structuredClone(initialState),
      selectedProjectId: "p1",
      selectedSessionId: null,
      draft: true,
      projects: [{ id: "p1", name: "app", path: "/tmp/app", expanded: true }],
    })
    const handle: StoreHandle = { state, setState, client: stubClient() }
    const runtime = createRuntimeSlice(handle, { skipQueueFlush: {}, sendAfterIdle: {}, flushing: {} })

    runtime.setComposer("还没提交的问题")

    const drafts = state.draftSessionsByProject["/tmp/app"]
    expect(drafts).toHaveLength(1)
    expect(drafts[0].localDraft).toBe(true)
    expect(drafts[0].title).toBe("还没提交的问题")
    expect(state.selectedSessionId).toBe(drafts[0].id)
    expect(state.drafts[`session:${drafts[0].id}`]?.composer).toBe("还没提交的问题")
  })

  it("does not delete a sibling empty draft while editing a filled one", async () => {
    const [state, setState] = createStore<AppState>({
      ...structuredClone(initialState),
      selectedProjectId: "p1",
      draft: true,
      projects: [{ id: "p1", name: "app", path: "/tmp/app", expanded: true }],
    })
    const handle: StoreHandle = { state, setState, client: stubClient() }
    const runtime = createRuntimeSlice(handle, { skipQueueFlush: {}, sendAfterIdle: {}, flushing: {} })
    const projects = createProjectSlice(handle)

    projects.startDraft()
    runtime.setComposer("已有内容")
    const filledId = state.selectedSessionId!
    projects.startDraft()
    expect(state.draftSessionsByProject["/tmp/app"]).toHaveLength(2)
    const emptyId = state.selectedSessionId!
    expect(emptyId).not.toBe(filledId)

    const filled = state.draftSessionsByProject["/tmp/app"].find((item) => item.id === filledId)!
    await projects.selectSession(filled)
    runtime.setComposer("已有内容更新")
    expect(state.draftSessionsByProject["/tmp/app"].map((item) => item.id).sort()).toEqual([emptyId, filledId].sort())
  })
})
