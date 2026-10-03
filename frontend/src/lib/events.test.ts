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
})
