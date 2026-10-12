import { describe, expect, it, vi } from "vitest"
import { createStore, produce } from "solid-js/store"
import { initialState, type AppState } from "./state"
import type { AgentClient } from "./ports"
import { createRuntimeSlice } from "./runtime-slice"
import type { UserMessage } from "../lib/types"
import { applyClientEvent } from "./apply-event"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function setup(overrides: Partial<AgentClient> = {}) {
  const [state, setState] = createStore<AppState>({
    ...structuredClone(initialState), connection: "connected", selectedProjectId: "p1", selectedSessionId: "s1",
    projects: [{ id: "p1", name: "app", path: "/tmp/app", expanded: true }],
    sessionsByProject: { "/tmp/app": [{ id: "s1", directory: "/tmp/app", title: "session", time: { created: 1, updated: 1 } }] },
    status: { s1: { type: "idle" } }, drafts: { "session:s1": { composer: "请检查", attachments: [] } },
    configuredModels: [{ id: "m", name: "model", providerID: "test", providerName: "Test", modelID: "model", baseURL: "https://example.com", apiKey: "fixture" }], selectedModelKey: "test/model",
  })
  const client = { updateSessionPermission: vi.fn().mockResolvedValue(undefined), promptAsync: vi.fn().mockResolvedValue(undefined), abortSession: vi.fn().mockResolvedValue(undefined),
    listMessages: vi.fn().mockResolvedValue([]), listSessionStatuses: vi.fn().mockResolvedValue({}), listPermissions: vi.fn().mockResolvedValue([]), listQuestions: vi.fn().mockResolvedValue([]), ...overrides } as AgentClient
  const runtime = createRuntimeSlice({ state, setState, client }, { skipQueueFlush: {}, sendAfterIdle: {}, flushing: {} })
  return { state, setState, client, runtime }
}

describe("delivery, stop and idle reconciliation", () => {
  it("shows the user message before HTTP acknowledgement using the same server IDs", async () => {
    const http = deferred<void>()
    const { runtime, state, client } = setup({ promptAsync: vi.fn(() => http.promise) })
    const sending = runtime.send()
    const message = state.messages.s1[0]
    expect(message).toMatchObject({ role: "user", delivery: "sending" })
    expect(state.parts[message.id][0]).toMatchObject({ text: "请检查" })
    await vi.waitFor(() => expect(client.promptAsync).toHaveBeenCalled())
    expect(client.promptAsync).toHaveBeenCalledWith("/tmp/app", "s1", expect.objectContaining({ messageID: message.id, partIDs: state.parts[message.id].map((part) => part.id) }))
    http.resolve()
    await sending
    expect(state.messages.s1[0]).not.toHaveProperty("delivery", "sending")
    expect(state.status.s1.type).toBe("busy")
  })
  it("retries a failed delivery with its original identity and preserves a newly typed draft", async () => {
    const { runtime, state, client } = setup({ promptAsync: vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined) })
    await runtime.send()
    const id = state.messages.s1[0].id
    expect(state.messages.s1[0]).toMatchObject({ delivery: "failed" })
    runtime.setComposer("另一条草稿")
    await runtime.retrySend(id)
    expect(state.messages.s1).toHaveLength(1)
    expect(client.promptAsync).toHaveBeenLastCalledWith("/tmp/app", "s1", expect.objectContaining({ messageID: id, text: "请检查" }))
    expect(runtime.composer()).toBe("另一条草稿")
  })
  it("does not resend when an acknowledgement arrived but the HTTP response was lost", async () => {
    const http = deferred<void>()
    const { runtime, state, setState, client } = setup({ promptAsync: vi.fn(() => http.promise) })
    const sending = runtime.send()
    await vi.waitFor(() => expect(client.promptAsync).toHaveBeenCalled())
    const message = { ...state.messages.s1[0] } as UserMessage
    delete message.delivery
    setState(produce((draft) => { applyClientEvent(draft, { event: { type: "message.updated", properties: { info: message } } }) }))
    http.reject(new Error("Failed to fetch"))
    await sending
    expect(state.messages.s1[0]).not.toHaveProperty("delivery")
    expect(Object.keys(state.outgoing)).toEqual([])
    expect(state.status.s1.type).toBe("busy")
  })
  it("verifies an uncertain send before retrying and does not submit an accepted request twice", async () => {
    const { runtime, state, client } = setup({ promptAsync: vi.fn().mockRejectedValue(new Error("Failed to fetch")) })
    await runtime.send()
    const id = state.messages.s1[0].id
    expect(state.messages.s1[0]).toMatchObject({ delivery: "uncertain" })
    const message = { ...state.messages.s1[0] } as UserMessage; delete message.delivery
    vi.mocked(client.listMessages).mockResolvedValue([{ info: message, parts: [] }])
    await runtime.retrySend(id)
    expect(client.promptAsync).toHaveBeenCalledTimes(1)
    expect(state.messages.s1[0]).not.toHaveProperty("delivery", "uncertain")
  })
  it("keeps stopping visible until the idle snapshot confirms the stop", async () => {
    const http = deferred<boolean>()
    const { runtime, state, setState } = setup({ abortSession: vi.fn(() => http.promise) })
    setState("messages", "s1", [{ id: "u1", role: "user", sessionID: "s1", time: { created: 1 } }])
    setState("status", "s1", { type: "busy" })
    const stop = runtime.abort()
    expect(runtime.stopping()).toBe(true)
    http.resolve(true)
    await stop
    expect(runtime.stopping()).toBe(false)
    expect(state.stoppedTurnBySession.s1).toBe("u1")
  })
  it("restores the running status if the stop request fails", async () => {
    const { runtime, state, setState } = setup({ abortSession: vi.fn().mockRejectedValue(new Error("cannot stop")) })
    setState("status", "s1", { type: "busy" })
    await runtime.abort()
    expect(runtime.stopping()).toBe(false)
    expect(state.status.s1.type).toBe("busy")
    expect(state.stoppedTurnBySession.s1).toBeUndefined()
    expect(state.error).toContain("cannot stop")
  })
  it("blocks the queue while idle tail data is being reconciled", async () => {
    const snapshot = deferred<Awaited<ReturnType<AgentClient["listMessages"]>>>()
    const { runtime, state, setState, client } = setup({ listMessages: vi.fn(() => snapshot.promise) })
    setState("queuedBySession", "s1", [{ id: "q1", text: "下一条", attachments: [], agent: "build", model: { providerID: "test", modelID: "model" }, variant: null, directory: "/tmp/app" }])
    const settling = runtime.settleSession("s1")
    await runtime.flushQueue("s1")
    expect(client.promptAsync).not.toHaveBeenCalled()
    expect(state.queuedBySession.s1).toHaveLength(1)
    snapshot.resolve([])
    await settling
    expect(client.promptAsync).toHaveBeenCalledTimes(1)
  })
})
