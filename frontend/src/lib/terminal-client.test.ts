import { afterEach, expect, it, vi } from "vitest"
import fixture from "../../../config/contracts/terminal-record.json"
import { parseTerminalInfo, parseTerminalLog } from "./terminal-contracts"
import { subscribeTerminal } from "./terminal-client"

afterEach(() => vi.unstubAllGlobals())

it("consumes the shared backend/native record fixture and rejects invalid wire values", () => {
  expect(parseTerminalInfo(fixture)).toMatchObject({ status: "completed", cursor: 7, id: fixture.id })
  expect(() => parseTerminalInfo({ ...fixture, cursor: -1 })).toThrow()
  expect(() => parseTerminalInfo({ ...fixture, status: "unknown" })).toThrow()
  expect(() =>
    parseTerminalLog({
      data: "",
      start: 0,
      cursor: 2,
      baseCursor: 0,
      endCursor: 1,
      truncated: false,
      status: "running",
    }),
  ).toThrow()
})

it("decodes split SSE frames, advances the cursor and closes a completed stream", async () => {
  const frame = {
    data: "Zml4dHVyZQ==",
    start: 0,
    cursor: 7,
    baseCursor: 0,
    endCursor: 7,
    truncated: false,
    status: "completed",
    ended: true,
  }
  const payload = `data: ${JSON.stringify(frame)}\r\n\r\n`
  const cancel = vi.fn()
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            const bytes = new TextEncoder().encode(payload)
            controller.enqueue(bytes.slice(0, 9))
            controller.enqueue(bytes.slice(9, -1))
            controller.enqueue(bytes.slice(-1))
          },
          cancel,
        }),
      ),
    ),
  )
  const onFrame = vi.fn(),
    onError = vi.fn()
  const stop = subscribeTerminal((at) => `http://fixture.invalid/log?cursor=${at}`, 0, onFrame, onError)
  await vi.waitFor(() => expect(onFrame).toHaveBeenCalledWith(frame))
  await vi.waitFor(() => expect(cancel).toHaveBeenCalled())
  stop()
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(onError).toHaveBeenCalledWith("")
})

it("reports malformed frames and cancellation prevents reconnect", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("data: {bad}\n\n")))
  const onError = vi.fn()
  const stop = subscribeTerminal(() => "http://fixture.invalid/log", 0, vi.fn(), onError)
  await vi.waitFor(() => expect(onError.mock.calls.some(([message]) => Boolean(message))).toBe(true))
  stop()
  expect(fetch).toHaveBeenCalledTimes(1)
})
