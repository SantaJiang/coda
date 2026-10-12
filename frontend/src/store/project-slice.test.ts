import { describe, expect, it, vi } from "vitest"
import { createStore } from "solid-js/store"
import type { MessageWithParts, Session } from "../lib/types"
import type { StoreHandle } from "./handle"
import type { AgentClient } from "./ports"
import { createProjectSlice } from "./project-slice"
import { initialState, type AppState } from "./state"

function stubClient(overrides: Partial<AgentClient> = {}): AgentClient {
  return {
    healthcheck: vi.fn(),
    listProviders: vi.fn(),
    patchGlobalConfig: vi.fn(),
    listProjects: vi.fn(),
    listSessions: vi.fn(),
    listSessionStatuses: vi.fn(),
    listMessages: vi.fn(),
    listTodos: vi.fn().mockResolvedValue([]),
    listPermissions: vi.fn().mockResolvedValue([]),
    listQuestions: vi.fn().mockResolvedValue([]),
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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe("project session detail synchronization", () => {
  it("routes status lookup through the selected project and preserves SSE updates newer than the snapshot", async () => {
    const directory = "/tmp/project"
    const session: Session = {
      id: "s1",
      directory,
      title: "session",
      time: { created: 1, updated: 1 },
    }
    const snapshot = deferred<MessageWithParts[]>()
    const listSessionStatuses = vi.fn().mockResolvedValue({ s1: { type: "busy" } })
    const client = stubClient({
      listMessages: vi.fn(() => snapshot.promise),
      listSessionStatuses,
    })
    const [state, setState] = createStore<AppState>({
      ...structuredClone(initialState),
      projects: [{ id: "p1", name: "project", path: directory, expanded: true }],
      sessionsByProject: { [directory]: [session] },
      selectedProjectId: "p1",
    })
    const handle: StoreHandle = { state, setState, client }
    const projects = createProjectSlice(handle)
    const loading = projects.selectSession(session)

    setState("messages", "s1", [
      {
        id: "a1",
        sessionID: "s1",
        role: "assistant",
        parentID: "u1",
        time: { created: 1_000, completed: 3_000 },
      },
    ])
    setState("parts", "a1", [
      {
        id: "r1",
        sessionID: "s1",
        messageID: "a1",
        type: "reasoning",
        text: "complete thought",
        time: { start: 1_000, end: 3_000 },
      },
    ])
    setState("status", "s1", { type: "idle" })

    snapshot.resolve([
      {
        info: {
          id: "a1",
          sessionID: "s1",
          role: "assistant",
          parentID: "u1",
          time: { created: 1_000 },
        },
        parts: [
          {
            id: "r1",
            sessionID: "s1",
            messageID: "a1",
            type: "reasoning",
            text: "complete",
            time: { start: 1_000 },
          },
        ],
      },
    ])
    await loading

    expect(listSessionStatuses).toHaveBeenCalledWith(directory)
    expect(state.status.s1).toEqual({ type: "idle" })
    expect(state.messages.s1[0]?.role === "assistant" ? state.messages.s1[0].time.completed : undefined).toBe(3_000)
    expect(state.parts.a1[0]).toMatchObject({
      type: "reasoning",
      text: "complete thought",
      time: { start: 1_000, end: 3_000 },
    })
  })

  it("unsticks busy when messages settle during a raced snapshot", async () => {
    const directory = "/tmp/project"
    const session: Session = {
      id: "s1",
      directory,
      title: "session",
      time: { created: 1, updated: 1 },
    }
    const snapshot = deferred<MessageWithParts[]>()
    const client = stubClient({
      listMessages: vi.fn(() => snapshot.promise),
      listSessionStatuses: vi.fn().mockResolvedValue({ s1: { type: "busy" } }),
    })
    const [state, setState] = createStore<AppState>({
      ...structuredClone(initialState),
      projects: [{ id: "p1", name: "project", path: directory, expanded: true }],
      sessionsByProject: { [directory]: [session] },
      selectedProjectId: "p1",
    })
    const projects = createProjectSlice({ state, setState, client })
    const loading = projects.selectSession(session)

    setState("messages", "s1", [
      {
        id: "a1",
        sessionID: "s1",
        role: "assistant",
        parentID: "u1",
        time: { created: 1_000, completed: 3_000 },
      },
    ])
    setState("status", "s1", { type: "busy" })

    snapshot.resolve([
      {
        info: {
          id: "a1",
          sessionID: "s1",
          role: "assistant",
          parentID: "u1",
          time: { created: 1_000, completed: 3_000 },
        },
        parts: [],
      },
    ])
    await loading

    expect(state.status.s1).toEqual({ type: "idle" })
  })

  it("does not restore busy from a stale status map when the snapshot already settled", async () => {
    const directory = "/tmp/project"
    const session: Session = {
      id: "s1",
      directory,
      title: "session",
      time: { created: 1, updated: 1 },
    }
    const client = stubClient({
      listMessages: vi.fn().mockResolvedValue([
        {
          info: {
            id: "a1",
            sessionID: "s1",
            role: "assistant",
            parentID: "u1",
            time: { created: 1_000, completed: 3_000 },
          },
          parts: [],
        },
      ]),
      listSessionStatuses: vi.fn().mockResolvedValue({ s1: { type: "busy" } }),
    })
    const [state, setState] = createStore<AppState>({
      ...structuredClone(initialState),
      projects: [{ id: "p1", name: "project", path: directory, expanded: true }],
      sessionsByProject: { [directory]: [session] },
      selectedProjectId: "p1",
      status: { s1: { type: "idle" } },
    })
    const projects = createProjectSlice({ state, setState, client })
    await projects.selectSession(session)

    expect(state.status.s1).toEqual({ type: "idle" })
  })
})

describe("refreshProjectSessions", () => {
  const directory = "/tmp/project"
  const project = { id: "p1", name: "project", path: directory, expanded: true }

  it("does not pin a startup connection failure on the session page", async () => {
    const [state, setState] = createStore<AppState>({
      ...structuredClone(initialState),
      projects: [project],
      selectedProjectId: "p1",
    })
    const projects = createProjectSlice({
      state,
      setState,
      client: stubClient({ listSessions: vi.fn().mockRejectedValue(new TypeError("Load failed")) }),
    })

    await projects.refreshProjectSessions(project)

    expect(state.error).toBeNull()
  })

  it("still shows a real session-list failure", async () => {
    const [state, setState] = createStore<AppState>({
      ...structuredClone(initialState),
      projects: [project],
      selectedProjectId: "p1",
    })
    const projects = createProjectSlice({
      state,
      setState,
      client: stubClient({ listSessions: vi.fn().mockRejectedValue(new Error("directory is not a project")) }),
    })

    await projects.refreshProjectSessions(project)

    expect(state.error).toBe("directory is not a project")
  })
})

describe("startDraft", () => {
  const directory = "/tmp/project"
  const project = { id: "p1", name: "project", path: directory, expanded: true }

  function setup() {
    const [state, setState] = createStore<AppState>({
      ...structuredClone(initialState),
      projects: [project],
      selectedProjectId: "p1",
      draft: true,
    })
    const projects = createProjectSlice({ state, setState, client: stubClient() })
    return { state, setState, projects }
  }

  it("creates a tree draft named 新会话 and reuses the empty one", () => {
    const { state, projects } = setup()
    projects.startDraft()
    const first = state.draftSessionsByProject[directory]
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({ title: "新会话", localDraft: true })
    expect(state.selectedSessionId).toBe(first[0].id)

    const createdAt = first[0].time.updated
    projects.startDraft()
    expect(state.draftSessionsByProject[directory]).toHaveLength(1)
    expect(state.selectedSessionId).toBe(first[0].id)
    expect(state.draftSessionsByProject[directory][0].time.updated).toBeGreaterThanOrEqual(createdAt)
  })

  it("keeps a filled draft and creates another empty 新会话", () => {
    const { state, setState, projects } = setup()
    projects.startDraft()
    const filledId = state.selectedSessionId!
    setState("drafts", `session:${filledId}`, { composer: "还没发送", attachments: [] })
    setState("draftSessionsByProject", directory, 0, "title", "还没发送")

    projects.startDraft()
    const list = state.draftSessionsByProject[directory]
    expect(list).toHaveLength(2)
    expect(list.some((item) => item.id === filledId && item.title === "还没发送")).toBe(true)
    expect(state.selectedSessionId).not.toBe(filledId)
    const empty = list.find((item) => item.id === state.selectedSessionId)
    expect(empty?.title).toBe("新会话")
  })

  it("keeps plan mode when reusing an empty draft", () => {
    const { state, setState, projects } = setup()
    projects.startDraft()
    const id = state.selectedSessionId!
    setState({ selectedSessionId: null, draftPlanMode: true })
    projects.startDraft()
    expect(state.selectedSessionId).toBe(id)
    expect(state.planModeBySession[id]).toBe(true)
    expect(state.draftPlanMode).toBe(false)
  })
})
