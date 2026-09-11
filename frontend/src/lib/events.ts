import { API_BASE } from "./config"
import type { EventEnvelope, GlobalEvent } from "./types"

export type ParsedEvent = {
  directory?: string
  event: EventEnvelope
}

const STALE_STREAM_MS = 25_000
const RETRY_DELAY_MS = 1_500

export function unwrapEvent(raw: GlobalEvent): ParsedEvent | null {
  if (raw.payload && typeof raw.payload === "object" && "type" in raw.payload) {
    return {
      directory: raw.directory,
      event: raw.payload,
    }
  }
  if (raw.type) {
    return {
      directory: raw.directory,
      event: {
        id: raw.id,
        type: raw.type,
        properties: raw.properties,
        data: raw.data,
      },
    }
  }
  return null
}

export function subscribeEvents(onEvent: (parsed: ParsedEvent) => void, onStatus?: (connected: boolean) => void) {
  const abort = new AbortController()
  let timer: number | undefined

  const connect = async () => {
    while (!abort.signal.aborted) {
      const attempt = new AbortController()
      const forwardAbort = () => attempt.abort()
      abort.signal.addEventListener("abort", forwardAbort)
      let stale: number | undefined
      const bumpStale = () => {
        if (stale !== undefined) window.clearTimeout(stale)
        stale = window.setTimeout(() => attempt.abort(), STALE_STREAM_MS)
      }
      bumpStale()
      try {
        const response = await fetch(`${API_BASE}/global/event`, {
          headers: { Accept: "text/event-stream" },
          signal: attempt.signal,
        })
        if (!response.ok || !response.body) {
          throw new Error(`event stream ${response.status}`)
        }
        onStatus?.(true)
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        while (!abort.signal.aborted) {
          const { value, done } = await reader.read()
          if (done) break
          bumpStale()
          buffer += decoder.decode(value, { stream: true })
          const chunks = buffer.split("\n\n")
          buffer = chunks.pop() ?? ""
          for (const chunk of chunks) {
            const dataLine = chunk
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trim())
              .join("\n")
            if (!dataLine) continue
            try {
              const raw = JSON.parse(dataLine) as GlobalEvent
              const parsed = unwrapEvent(raw)
              if (parsed?.event.type && parsed.event.type !== "server.heartbeat") {
                onEvent(parsed)
              }
            } catch {
              // ignore malformed frames
            }
          }
        }
      } catch {
        if (abort.signal.aborted) return
      } finally {
        abort.signal.removeEventListener("abort", forwardAbort)
        if (stale !== undefined) window.clearTimeout(stale)
      }

      if (abort.signal.aborted) return
      onStatus?.(false)
      await new Promise<void>((resolve) => {
        timer = window.setTimeout(() => resolve(), RETRY_DELAY_MS)
      })
    }
  }

  void connect()

  return () => {
    abort.abort()
    if (timer) window.clearTimeout(timer)
  }
}
