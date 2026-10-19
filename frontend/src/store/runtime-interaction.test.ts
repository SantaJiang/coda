import { describe, expect, it, vi } from "vitest"
import { createStore, produce } from "solid-js/store"
import { initialState, type AppState } from "./state"
import type { AgentClient } from "./ports"
import { createRuntimeSlice } from "./runtime-slice"
import type { UserMessage } from "../lib/types"
import { applyClientEvent } from "./apply-event"
import { purgeSession } from "./gc"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function setup(overrides: Partial<AgentClient> = {}, beforePrompt?: () => Promise<void>) {
  const [state, setState] = createStore<AppState>({
    ...structuredClone(initialState), connection: "connected", selectedProjectId: "p1", selectedSessionId: "s1",
    projects: [{ id: "p1", name: "app", path: "/tmp/app", expanded: true }],
    sessionsByProject: { "/tmp/app": [{ id: "s1", directory: "/tmp/app", title: "session", time: { created: 1, updated: 1 } }] },
    status: { s1: { type: "idle" } }, drafts: { "session:s1": { composer: "请检查", attachments: [] } },
    configuredModels: [{ id: "m", name: "model", providerID: "test", providerName: "Test", modelID: "model", baseURL: "https://example.com", apiKey: "fixture" }], selectedModelKey: "test/model",
  })
  const client = { updateSessionPermission: vi.fn().mockResolvedValue(undefined), promptAsync: vi.fn().mockResolvedValue(undefined), abortSession: vi.fn().mockResolvedValue(undefined),
    listMessages: vi.fn().mockResolvedValue([]), listSessionStatuses: vi.fn().mockResolvedValue({}), listPermissions: vi.fn().mockResolvedValue([]), listQuestions: vi.fn().mockResolvedValue([]), listTodos: vi.fn().mockResolvedValue([]), ...overrides } as AgentClient
  const runtime = createRuntimeSlice({ state, setState, client }, { skipQueueFlush: {}, sendAfterIdle: {}, flushing: {}, beforePrompt })
  return { state, setState, client, runtime }
}

describe("delivery, stop and idle reconciliation", () => {
  it("unlocks a failed idle reconciliation and pauses the queue until resync succeeds", async () => {
    const listTodos = vi.fn().mockRejectedValueOnce(new Error("todo endpoint unavailable")).mockResolvedValue([])
    const { runtime, state, setState, client } = setup({ listTodos })
    setState("queuedBySession", "s1", [{ id: "q1", text: "下一条", attachments: [], agent: "build", model: { providerID: "test", modelID: "model" }, variant: null, directory: "/tmp/app" }])
    await runtime.settleSession("s1")
    expect(runtime.settling()).toBe(false)
    expect(state.syncErrors.s1).toContain("unavailable")
    await runtime.flushQueue("s1")
    expect(client.promptAsync).not.toHaveBeenCalled()
    await runtime.resync()
    expect(client.promptAsync).toHaveBeenCalledOnce()
  })
  it("reads the final snapshot again if another idle boundary arrived during the previous read", async () => {
    const first = deferred<Awaited<ReturnType<AgentClient["listMessages"]>>>()
    const finalMessage = { id: "a1", role: "assistant" as const, sessionID: "s1", time: { created: 1, completed: 2 } }
    const listMessages = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue([{ info: finalMessage, parts: [] }])
    const { runtime, state, setState } = setup({ listMessages })
    const settling = runtime.settleSession("s1")
    setState(produce((draft) => applyClientEvent(draft, { event: { type: "session.idle", properties: { sessionID: "s1" } } })))
    void runtime.settleSession("s1")
    first.resolve([])
    await settling
    expect(listMessages).toHaveBeenCalledTimes(2)
    expect(state.messages.s1).toEqual([finalMessage])
    expect(runtime.settling()).toBe(false)
  })
  it("does not let a purged send's late cleanup clear a newer send lock", async () => {
    const config = deferred<void>()
    const { runtime, state, setState, client } = setup({}, () => config.promise)
    const sending = runtime.send()
    setState(produce((draft) => purgeSession(draft, "s1", false)))
    setState("sendingBySession", "s1", true)
    config.resolve()
    await sending
    expect(state.sendingBySession.s1).toBe(true)
    expect(client.promptAsync).not.toHaveBeenCalled()
  })
  it("cancels a send waiting for configuration when the user presses stop", async () => {
    const config = deferred<void>()
    const { runtime, state, client } = setup({}, () => config.promise)
    const sending = runtime.send()
    await Promise.resolve()
    await runtime.abort()
    config.resolve()
    await sending
    expect(client.promptAsync).not.toHaveBeenCalled()
    expect(runtime.busy()).toBe(false)
    const id = state.messages.s1[0].id
    await runtime.retrySend(id)
    expect(client.promptAsync).toHaveBeenCalledOnce()
    expect(state.stoppedTurns[id]).toBeUndefined()
  })
  it("cancels a first send while its backend session is still being created", async () => {
    const created = deferred<Awaited<ReturnType<AgentClient["createSession"]>>>()
    const { runtime, state, setState, client } = setup({ createSession: vi.fn(() => created.promise) })
    setState("selectedSessionId", "draft_1")
    setState("draftSessionsByProject", "/tmp/app", [{ id: "draft_1", localDraft: true, directory: "/tmp/app", title: "draft", time: { created: 1, updated: 1 } }])
    setState("drafts", "session:draft_1", { composer: "第一条", attachments: [] })
    const sending = runtime.send()
    await runtime.abort()
    created.resolve({ id: "created", directory: "/tmp/app", title: "created", time: { created: 2, updated: 2 } })
    await sending
    expect(client.promptAsync).not.toHaveBeenCalled()
    expect(state.messages.created[0]).toMatchObject({ delivery: "failed", deliveryError: "已停止，消息尚未发送" })
    expect(runtime.busy()).toBe(false)
    expect(runtime.stopping()).toBe(false)
  })
  it("stops a late HTTP acceptance before allowing queued messages to run", async () => {
    const http = deferred<void>()
    const { runtime, state, client } = setup({ promptAsync: vi.fn(() => http.promise) })
    const sending = runtime.send()
    await vi.waitFor(() => expect(client.promptAsync).toHaveBeenCalledOnce())
    await runtime.abort()
    runtime.setComposer("保留在队列")
    await runtime.send()
    http.resolve()
    await sending
    expect(client.abortSession).toHaveBeenCalledTimes(2)
    expect(client.promptAsync).toHaveBeenCalledOnce()
    expect(state.queuedBySession.s1).toHaveLength(1)
    expect(runtime.stopping()).toBe(false)
  })
  it("accepts an idle event for a fast queued reply while the previous reconciliation is still awaiting HTTP", async () => {
    const http = deferred<void>()
    const { runtime, state, setState, client } = setup({ promptAsync: vi.fn(() => http.promise) })
    setState("queuedBySession", "s1", [{ id: "q1", text: "快速回复", attachments: [], agent: "build", model: { providerID: "test", modelID: "model" }, variant: null, directory: "/tmp/app" }])
    const first = runtime.settleSession("s1")
    await vi.waitFor(() => expect(client.promptAsync).toHaveBeenCalledOnce())
    setState(produce((draft) => applyClientEvent(draft, { event: { type: "session.idle", properties: { sessionID: "s1" } } })))
    const second = runtime.settleSession("s1")
    http.resolve()
    await Promise.all([first, second])
    expect(state.settlingBySession.s1).toBe(false)
    expect(runtime.busy()).toBe(false)
  })
  it("refreshes live status after confirming a lost queued acknowledgement before sending the next item", async () => {
    const { runtime, state, setState, client } = setup({ promptAsync: vi.fn().mockRejectedValueOnce(new Error("Failed to fetch")).mockResolvedValue(undefined) })
    const message = (id: string) => ({ id, text: id, attachments: [], agent: "build", model: { providerID: "test", modelID: "model" }, variant: null, directory: "/tmp/app" })
    setState("queuedBySession", "s1", [message("q1"), message("q2")])
    await runtime.flushQueue("s1")
    const accepted = { ...state.messages.s1[0] } as UserMessage
    delete accepted.delivery
    vi.mocked(client.listMessages).mockResolvedValue([{ info: accepted, parts: [] }])
    vi.mocked(client.listSessionStatuses).mockResolvedValue({ s1: { type: "busy" } })
    await runtime.flushQueue("s1")
    expect(client.promptAsync).toHaveBeenCalledOnce()
    expect(state.queuedBySession.s1.map((item) => item.id)).toEqual(["q2"])
    expect(state.status.s1.type).toBe("busy")
  })
  it("keeps a paste that finishes after a local draft acquires its backend session ID", async () => {
    const created = deferred<Awaited<ReturnType<AgentClient["createSession"]>>>()
    const read = deferred<ArrayBuffer>()
    const { runtime, state, setState } = setup({ createSession: vi.fn(() => created.promise) })
    setState("selectedSessionId", "draft_1")
    setState("draftSessionsByProject", "/tmp/app", [{ id: "draft_1", localDraft: true, directory: "/tmp/app", title: "draft", time: { created: 1, updated: 1 } }])
    setState("drafts", "session:draft_1", { composer: "第一条", attachments: [] })
    const sending = runtime.send()
    const importing = runtime.importAttachments({ files: [{ name: "next.json", type: "application/json", size: 2, arrayBuffer: () => read.promise } as File] })
    created.resolve({ id: "created", directory: "/tmp/app", title: "created", time: { created: 2, updated: 2 } })
    await vi.waitFor(() => expect(state.selectedSessionId).toBe("created"))
    expect(runtime.attachmentsLoading()).toBe(true)
    read.resolve(new TextEncoder().encode("{}").buffer)
    await Promise.all([sending, importing])
    expect(runtime.attachments()[0]).toMatchObject({ filename: "next.json" })
    expect(runtime.attachmentsLoading()).toBe(false)
    expect(state.drafts["session:draft_1"]).toBeUndefined()
  })
  it("keeps asynchronous file reads with their original session and blocks premature send", async () => {
    const read = deferred<ArrayBuffer>()
    const { runtime, state, setState, client } = setup()
    const importing = runtime.importAttachments({ files: [{ name: "data.json", type: "application/json", size: 2, arrayBuffer: () => read.promise } as File] })
    expect(runtime.attachmentsLoading()).toBe(true)
    await runtime.send()
    expect(client.promptAsync).not.toHaveBeenCalled()
    setState("selectedSessionId", "s2")
    setState("drafts", "session:s2", { composer: "第二个会话", attachments: [] })
    read.resolve(new TextEncoder().encode("{}").buffer)
    await importing
    expect(state.drafts["session:s1"].attachments[0]).toMatchObject({ filename: "data.json", mime: "text/plain" })
    expect(runtime.composer()).toBe("第二个会话")
    expect(runtime.attachments()).toEqual([])
    expect(state.attachmentImports["session:s1"]).toBe(0)
  })
  it("does not resurrect attachments after their session was deleted", async () => {
    const read = deferred<ArrayBuffer>()
    const { runtime, state, setState } = setup()
    const importing = runtime.importAttachments({ files: [{ name: "note.txt", type: "text/plain", size: 2, arrayBuffer: () => read.promise } as File] })
    setState(produce((draft) => purgeSession(draft, "s1")))
    read.resolve(new TextEncoder().encode("ok").buffer)
    await importing
    expect(state.drafts["session:s1"]).toBeUndefined()
    expect(state.attachmentImports["session:s1"]).toBeUndefined()
  })
  it("preserves the draft on unsupported media and sends it after switching to a capable model", async () => {
    const { runtime, state, setState, client } = setup()
    const image = { name: "capture.png", type: "image/png", size: 4, arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer } as File
    await runtime.importAttachments({ files: [image] })
    await runtime.send()
    expect(client.promptAsync).not.toHaveBeenCalled()
    expect(runtime.composer()).toBe("请检查")
    expect(runtime.attachments()).toHaveLength(1)
    expect(state.error).toContain("图片")
    setState("configuredModels", 0, "inputModalities", ["image"])
    await runtime.send()
    expect(client.promptAsync).toHaveBeenCalledWith("/tmp/app", "s1", expect.objectContaining({ files: [expect.objectContaining({ mime: "image/png", filename: "capture.png" })] }))
    expect(runtime.attachments()).toEqual([])
  })
  it("keeps valid files in a mixed paste and reports unsupported binary files", async () => {
    const { runtime, state } = setup()
    const makeFile = (name: string, data: number[]) => ({ name, type: "", size: data.length, arrayBuffer: async () => new Uint8Array(data).buffer }) as File
    await runtime.importAttachments({ files: [makeFile("note.txt", [104, 105]), makeFile("archive.zip", [80, 75, 0])] })
    expect(runtime.attachments().map((file) => file.filename)).toEqual(["note.txt"])
    expect(state.error).toContain("archive.zip")
    expect(runtime.attachmentsLoading()).toBe(false)
    await runtime.importAttachments({ files: [{ name: "native.bin", size: 0, arrayBuffer: async () => { throw "单个附件不能超过 25 MiB" } } as unknown as File] })
    expect(state.error).toBe("单个附件不能超过 25 MiB")
  })
  it("waits for model configuration to finish before starting a prompt", async () => {
    const configured = deferred<void>()
    const { runtime, client } = setup({}, () => configured.promise)
    const sending = runtime.send()
    await Promise.resolve()
    expect(client.promptAsync).not.toHaveBeenCalled()
    configured.resolve()
    await sending
    expect(client.promptAsync).toHaveBeenCalledOnce()
  })
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
