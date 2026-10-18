import { describe, expect, it, vi } from "vitest"
import { createStore, produce } from "solid-js/store"
import { initialState, type AppState } from "./state"
import { reconcileSession } from "./session-reconcile"
import { applyClientEvent } from "./apply-event"
import type { AgentClient } from "./ports"
import type { MessageWithParts, Part } from "../lib/types"

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes }); return { promise, resolve } }
const message = { id: "a1", role: "assistant" as const, sessionID: "s1", parentID: "u1", time: { created: 2, completed: 3 }, finish: "stop" }
const part = (id: string, text: string): Part => ({ id, type: "text", text, sessionID: "s1", messageID: "a1" })
function setup(overrides: Partial<AgentClient> = {}) {
  const [state, setState] = createStore<AppState>({ ...structuredClone(initialState), status: { s1: { type: "idle" } }, messages: { s1: [message] }, parts: { a1: [part("p1", "already complete"), part("p2", "removed later")] }, settlingBySession: { s1: true } })
  const client = { listMessages: vi.fn().mockResolvedValue([{ info: message, parts: [part("p1", "already complete")] }]), listSessionStatuses: vi.fn().mockResolvedValue({}), listPermissions: vi.fn().mockResolvedValue([]), listQuestions: vi.fn().mockResolvedValue([]), listTodos: vi.fn().mockResolvedValue([]), ...overrides } as AgentClient
  return { state, setState, handle: { state, setState, client } }
}
describe("idle boundary synchronization", () => {
  it("preserves new SSE status, longer prose and removal tombstones while loading", async () => {
    const snapshot = deferred<MessageWithParts[]>()
    const { state, setState, handle } = setup({ listMessages: vi.fn(() => snapshot.promise) })
    const loading = reconcileSession(handle, "s1", "/tmp/app")
    setState(produce((draft) => {
      applyClientEvent(draft, { event: { type: "message.part.removed", properties: { messageID: "a1", partID: "p2" } } })
      applyClientEvent(draft, { event: { type: "message.part.delta", properties: { messageID: "a1", partID: "p1", sessionID: "s1", delta: " and newer" } } })
      applyClientEvent(draft, { event: { type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } } } })
    }))
    snapshot.resolve([{ info: { ...message, time: { created: 2 } }, parts: [part("p1", "old"), part("p2", "stale removed")] }])
    await loading
    expect(state.status.s1.type).toBe("busy")
    expect(state.parts.a1).toHaveLength(1)
    expect(state.parts.a1[0]).toMatchObject({ text: "already complete and newer" })
    expect(state.messages.s1[0]).toMatchObject({ time: { completed: 3 } })
    expect(state.settlingBySession.s1).toBeUndefined()
  })
  it("does not resurrect a removed request and preserves requests received during the snapshot", async () => {
    const permissions = deferred<Awaited<ReturnType<AgentClient["listPermissions"]>>>()
    const { state, setState, handle } = setup({ listPermissions: vi.fn(() => permissions.promise) })
    const first = { id: "per1", sessionID: "s1", permission: "edit", patterns: [] }
    setState("permissions", "per1", first)
    const loading = reconcileSession(handle, "s1", "/tmp/app")
    setState(produce((draft) => {
      applyClientEvent(draft, { event: { type: "permission.replied", properties: { requestID: "per1", sessionID: "s1" } } })
      applyClientEvent(draft, { event: { type: "permission.asked", properties: { ...first, id: "per2" } } })
    }))
    permissions.resolve([first])
    await loading
    expect(Object.keys(state.permissions)).toEqual(["per2"])
  })
  it("keeps the reconciliation barrier when loading fails", async () => {
    const { state, handle } = setup({ listMessages: vi.fn().mockRejectedValue(new Error("offline")) })
    await expect(reconcileSession(handle, "s1", "/tmp/app")).rejects.toThrow("offline")
    expect(state.settlingBySession.s1).toBe(true)
  })
})

it("does not restore a part that arrived and was removed after the snapshot began", async () => {
  const snapshot = deferred<MessageWithParts[]>()
  const { state, setState, handle } = setup({ listMessages: vi.fn(() => snapshot.promise) })
  const loading = reconcileSession(handle, "s1", "/tmp/app")
  setState(produce((draft) => {
    applyClientEvent(draft, { event: { type: "message.part.updated", properties: { part: part("late", "temporary") } } })
    applyClientEvent(draft, { event: { type: "message.part.removed", properties: { messageID: "a1", partID: "late", sessionID: "s1" } } })
    applyClientEvent(draft, { event: { type: "message.part.delta", properties: { messageID: "a1", partID: "late", sessionID: "s1", delta: "late duplicate" } } })
  }))
  snapshot.resolve([{ info: message, parts: [part("p1", "already complete"), part("late", "stale snapshot")] }])
  await loading
  expect(state.parts.a1.some((part) => part.id === "late")).toBe(false)
})

it("refreshes todos at the idle boundary instead of retaining a missed SSE update", async () => {
  const completed = [{ content: "build", status: "completed", priority: "high" }]
  const { state, setState, handle } = setup({ listTodos: vi.fn().mockResolvedValue(completed) })
  setState("todos", "s1", [{ content: "build", status: "in_progress", priority: "high" }])
  await reconcileSession(handle, "s1", "/tmp/app")
  expect(state.todos.s1).toEqual(completed)
})
it("does not overwrite newer todo events with an idle snapshot", async () => {
  const snapshot = deferred<Awaited<ReturnType<AgentClient["listTodos"]>>>()
  const { state, setState, handle } = setup({ listTodos: vi.fn(() => snapshot.promise) })
  const loading = reconcileSession(handle, "s1", "/tmp/app")
  const completed = [{ content: "build", status: "completed", priority: "high" }]
  setState(produce((draft) => { applyClientEvent(draft, { event: { type: "todo.updated", properties: { sessionID: "s1", todos: completed } } }) }))
  snapshot.resolve([{ content: "build", status: "in_progress", priority: "high" }])
  await loading
  expect(state.todos.s1).toEqual(completed)
})

it("preserves a repeated latest todo event even when its contents match the initial list", async () => {
  const snapshot = deferred<Awaited<ReturnType<AgentClient["listTodos"]>>>()
  const { state, setState, handle } = setup({ listTodos: vi.fn(() => snapshot.promise) })
  const completed = [{ content: "build", status: "completed", priority: "high" }]
  setState("todos", "s1", structuredClone(completed))
  const loading = reconcileSession(handle, "s1", "/tmp/app")
  setState(produce((draft) => { applyClientEvent(draft, { event: { type: "todo.updated", properties: { sessionID: "s1", todos: structuredClone(completed) } } }) }))
  snapshot.resolve([{ content: "build", status: "in_progress", priority: "high" }])
  await loading
  expect(state.todos.s1).toEqual(completed)
})
