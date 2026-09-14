import { describe, expect, it } from "vitest"
import { shouldFlushQueue, takeDeferredSend, withSessionLock } from "../store/queue"
import type { QueuedMessage } from "../store/state"

const item: QueuedMessage = {
  id: "q1",
  text: "hi",
  attachments: [],
  agent: "build",
  model: { providerID: "openai", modelID: "gpt" },
  variant: null,
  directory: "/tmp/app",
}

describe("shouldFlushQueue", () => {
  it("blocks while another session send is in flight for this id, or while busy/retry/blocked", () => {
    const base = {
      sending: false,
      permissions: {},
      questions: {},
      sessionID: "s1",
    }
    expect(shouldFlushQueue({ ...base, sending: true })).toBe(false)
    expect(shouldFlushQueue({ ...base, status: { type: "busy" } })).toBe(false)
    expect(shouldFlushQueue({ ...base, status: { type: "retry" } })).toBe(false)
    expect(
      shouldFlushQueue({
        ...base,
        permissions: { p: { id: "p", sessionID: "s1", permission: "edit", patterns: [] } },
      }),
    ).toBe(false)
    expect(shouldFlushQueue({ ...base, status: { type: "idle" } })).toBe(true)
  })
})

describe("takeDeferredSend", () => {
  it("returns deferred work before skip flags", () => {
    const sendAfterIdle = { s1: item }
    const skip = { s1: true }
    expect(takeDeferredSend(sendAfterIdle, skip, "s1")).toEqual({ kind: "deferred", item })
    expect(sendAfterIdle.s1).toBeUndefined()
    expect(skip.s1).toBe(false)
  })

  it("consumes a skip flag without flushing the queue", () => {
    const skip = { s1: true }
    expect(takeDeferredSend({}, skip, "s1")).toEqual({ kind: "skip" })
    expect(skip.s1).toBe(false)
  })

  it("is keyed per session", () => {
    const skip = { a: true }
    expect(takeDeferredSend({}, skip, "b")).toEqual({ kind: "next" })
    expect(skip.a).toBe(true)
  })
})

describe("withSessionLock", () => {
  it("serializes overlapping work for the same session", async () => {
    const locks: Record<string, boolean> = {}
    let started = 0
    const first = withSessionLock(locks, "s1", async () => {
      started += 1
      await Promise.resolve()
      return "a"
    })
    const second = withSessionLock(locks, "s1", async () => {
      started += 1
      return "b"
    })
    await expect(first).resolves.toBe("a")
    await expect(second).resolves.toBeUndefined()
    expect(started).toBe(1)
    await expect(withSessionLock(locks, "s1", async () => "c")).resolves.toBe("c")
  })
})
