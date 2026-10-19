import { afterEach, describe, expect, it, vi } from "vitest"
import { subscribeEvents } from "./events"

describe("subscribeEvents", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("marks the stream disconnected after silence and retries", async () => {
    vi.useFakeTimers()
    const statuses: boolean[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) =>
        Promise.resolve({
          ok: true,
          body: {
            getReader: () => ({
              read: () =>
                new Promise<{ value?: Uint8Array; done: boolean }>((_resolve, reject) => {
                  init?.signal?.addEventListener("abort", () => {
                    reject(new DOMException("Aborted", "AbortError"))
                  })
                }),
            }),
          },
        }),
      ),
    )

    const stop = subscribeEvents(() => undefined, (ok) => statuses.push(ok))
    await Promise.resolve()
    await Promise.resolve()
    expect(statuses).toEqual([true])

    await vi.advanceTimersByTimeAsync(25_000)
    expect(statuses).toContain(false)

    stop()
  })

  it("emits a final event that arrives without a trailing blank line", async () => {
    const events: string[] = []
    const encoder = new TextEncoder()
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          body: {
            getReader: () => ({
              read: vi
                .fn()
                .mockResolvedValueOnce({
                  value: encoder.encode('data: {"type":"session.idle","properties":{"sessionID":"s1"}}\n'),
                  done: false,
                })
                .mockResolvedValueOnce({ value: undefined, done: true }),
            }),
          },
        }),
      ),
    )
    const stop = subscribeEvents((parsed) => events.push(parsed.event.type))
    await vi.waitFor(() => expect(events).toEqual(["session.idle"]))
    stop()
  })

  it("reads CRLF event frames even when the separator is split across network chunks", async () => {
    const events: string[] = []
    const chunks = ['data: {"type":"session.status","properties":{"sessionID":"s1","status":{"type":"busy"}}}\r', '\n\r', '\ndata: {"type":"session.idle","properties":{"sessionID":"s1"}}\r\n\r', '\n']
    let index = 0
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, body: {
      getReader: () => ({ read: async () => index < chunks.length ? { value: new TextEncoder().encode(chunks[index++]), done: false } : { done: true } }),
    } })))
    const stop = subscribeEvents((parsed) => events.push(parsed.event.type))
    try { await vi.waitFor(() => expect(events).toEqual(["session.status", "session.idle"])) }
    finally { stop() }
  })
})
