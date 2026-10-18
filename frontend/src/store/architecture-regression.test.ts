// Regression coverage for the architecture audit concurrency findings.
import { afterEach, expect, it, vi } from "vitest"
import { createStore, produce } from "solid-js/store"
import { initialState, type AppState } from "./state"
import { createProjectSlice } from "./project-slice"
import { reconcileSession } from "./session-reconcile"
import { purgeSession } from "./gc"
import type { AgentClient } from "./ports"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

const session = {
  id: "s1",
  directory: "/tmp/coda-audit-fixture",
  title: "fixture",
  time: { created: 1, updated: 1 },
}

function setup(client: Partial<AgentClient>) {
  const [state, setState] = createStore<AppState>({
    ...structuredClone(initialState),
    projects: [{ id: "p1", name: "fixture", path: session.directory, expanded: true }],
    sessionsByProject: { [session.directory]: [session] },
    selectedProjectId: "p1",
    selectedSessionId: "s1",
  })
  return { state, setState, client: client as AgentClient }
}

afterEach(() => localStorage.clear())

it("AUDIT A02: ignores an old project failure after a newer successful result", async () => {
  const old = deferred<Awaited<ReturnType<AgentClient["listSessions"]>>>()
  const listSessions = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce([session])
  const handle = setup({ listSessions })
  const projects = createProjectSlice(handle)
  const project = handle.state.projects[0]
  const first = projects.refreshProjectSessions(project)
  await projects.refreshProjectSessions(project)
  expect(handle.state.sessionsByProject[session.directory]).toHaveLength(1)
  old.reject(new Error(`ENOENT: no such file or directory, lstat '${session.directory}'`))
  await first
  expect(handle.state.projects[0].missing).not.toBe(true)
  expect(handle.state.error).toBeNull()
})

it("AUDIT A03: ignores a reconciliation after the session was purged", async () => {
  const messages = deferred<Awaited<ReturnType<AgentClient["listMessages"]>>>()
  const handle = setup({
    listMessages: () => messages.promise,
    listSessionStatuses: async () => ({ s1: { type: "busy" } }),
    listPermissions: async () => [],
    listQuestions: async () => [],
    listTodos: async () => [],
  })
  const pending = reconcileSession(handle, "s1", session.directory)
  handle.setState(
    produce((draft) => {
      draft.sessionsByProject[session.directory] = []
      purgeSession(draft, "s1")
    }),
  )
  expect(handle.state.messages.s1).toBeUndefined()
  messages.resolve([
    {
      info: { id: "a-new", role: "assistant", sessionID: "s1", time: { created: 2 } },
      parts: [],
    },
  ])
  await pending
  expect(handle.state.sessionsByProject[session.directory]).toHaveLength(0)
  expect(handle.state.messages.s1).toBeUndefined()
  expect(handle.state.status.s1).toBeUndefined()
})

const bridge = vi.hoisted(() => vi.fn())
vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge }))

it("AUDIT A04: independent settings instances send only their dirty fields", async () => {
  vi.useFakeTimers()
  let file: Record<string, unknown> = { theme: "dark", sendShortcut: "enter" }
  const writes: unknown[] = []
  bridge.mockImplementation((command: string, args?: { patch: Record<string, unknown> }) => {
    if (command === "settings_read") return Promise.resolve(JSON.stringify(file))
    if (command === "settings_patch") {
      writes.push(args!.patch)
      file = { ...file, ...args!.patch }
      return Promise.resolve({ ...file })
    }
    throw new Error(`Unexpected fixture command: ${command}`)
  })
  try {
    vi.resetModules()
    const a = await import("../lib/shared")
    await a.hydrateShared(() => ({}))
    vi.resetModules()
    const b = await import("../lib/shared")
    await b.hydrateShared(() => ({}))
    a.setSharedValue({ theme: "light" })
    b.setSharedValue({ sendShortcut: "mod-enter" })
    await Promise.all([a.flushShared(), b.flushShared()])
    expect(file).toEqual({ theme: "light", sendShortcut: "mod-enter" })
    expect(writes).toEqual([{ theme: "light" }, { sendShortcut: "mod-enter" }])
  } finally {
    vi.clearAllTimers()
    vi.useRealTimers()
  }
})

it.each(["abort", "revert"])("AUDIT A03: ignores a late %s result after deletion", async (operation) => {
  const response = deferred<typeof session>()
  const handle = setup({
    abortSession: () => response.promise as never,
    revertSession: () => response.promise,
  })
  const { createRuntimeSlice } = await import("./runtime-slice")
  const runtime = createRuntimeSlice(handle, { skipQueueFlush: {}, sendAfterIdle: {}, flushing: {} })
  const pending = operation === "abort" ? runtime.abort() : runtime.revertToMessage("m1")
  handle.setState(
    produce((draft) => {
      draft.sessionsByProject[session.directory] = []
      purgeSession(draft, "s1")
    }),
  )
  if (operation === "abort") response.reject(new Error("late stop failure"))
  else response.resolve(session)
  await pending
  expect(handle.state.sessionsByProject[session.directory]).toEqual([])
  expect(handle.state.stoppingBySession.s1).toBeUndefined()
  expect(handle.state.drafts["session:s1"]).toBeUndefined()
  expect(handle.state.error).toBeNull()
})

it("retries creating a local session after a lost create response without querying a draft ID", async () => {
  const createSession = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue(session)
  const listMessages = vi.fn().mockResolvedValue([])
  const promptAsync = vi.fn().mockResolvedValue(undefined)
  const handle = setup({ createSession, listMessages, promptAsync, updateSessionPermission: async () => session })
  handle.setState("sessionsByProject", session.directory, [])
  handle.setState("draftSessionsByProject", session.directory, [{ ...session, id: "draft_1", localDraft: true }])
  handle.setState("selectedSessionId", "draft_1")
  handle.setState("configuredModels", [
    {
      id: "m",
      name: "fixture",
      providerName: "fixture",
      providerID: "fixture",
      modelID: "fixture",
      baseURL: "https://example.test",
      apiKey: "fixture",
    },
  ])
  handle.setState("selectedModelKey", "fixture/fixture")
  const { createRuntimeSlice } = await import("./runtime-slice")
  const runtime = createRuntimeSlice(handle, { skipQueueFlush: {}, sendAfterIdle: {}, flushing: {} })
  await runtime.send("fixture")
  const item = Object.values(handle.state.outgoing)[0]
  expect(item.sessionID).toBe("draft_1")
  await runtime.retrySend(item.messageID)
  expect(createSession).toHaveBeenCalledTimes(2)
  expect(listMessages).not.toHaveBeenCalled()
  expect(promptAsync).toHaveBeenCalledWith(session.directory, "s1", expect.objectContaining({ text: "fixture" }))
})

it("retains dirty settings after a native write failure and clears the error after retry", async () => {
  vi.useFakeTimers()
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true })
  let attempts = 0
  bridge.mockImplementation((command: string, args?: { patch: Record<string, unknown> }) => {
    if (command === "settings_read") return Promise.resolve("{}")
    if (command === "settings_patch") {
      if (++attempts === 1) return Promise.reject(new Error("fixture disk unavailable"))
      return Promise.resolve(args!.patch)
    }
    throw new Error(command)
  })
  try {
    vi.resetModules()
    const shared = await import("../lib/shared")
    await shared.hydrateShared(() => ({}))
    shared.setSharedValue({ theme: "light" })
    await shared.flushShared()
    expect(shared.sharedWriteError()).toBe("fixture disk unavailable")
    await shared.flushShared()
    expect(attempts).toBe(2)
    expect(shared.sharedValue("theme")).toBe("light")
    expect(shared.sharedWriteError()).toBeNull()
  } finally {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
    vi.clearAllTimers()
    vi.useRealTimers()
  }
})
