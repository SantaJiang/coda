import { API_BASE } from "./config"
import type { EventEnvelope, GlobalEvent } from "./types"

export type ParsedEvent = {
  directory?: string
  event: EventEnvelope
}

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

export function eventProps(event: EventEnvelope): Record<string, unknown> {
  return (event.properties ?? event.data ?? {}) as Record<string, unknown>
}

export function subscribeEvents(onEvent: (parsed: ParsedEvent) => void, onStatus?: (connected: boolean) => void) {
  let aborted = false
  let timer: number | undefined

  const connect = async () => {
    while (!aborted) {
      try {
        const response = await fetch(`${API_BASE}/global/event`, {
          headers: { Accept: "text/event-stream" },
        })
        if (!response.ok || !response.body) {
          throw new Error(`event stream ${response.status}`)
        }
        onStatus?.(true)
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        while (!aborted) {
          const { value, done } = await reader.read()
          if (done) break
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
        onStatus?.(false)
      }

      if (aborted) return
      onStatus?.(false)
      await new Promise((resolve) => {
        timer = window.setTimeout(resolve, 1500)
      })
    }
  }

  void connect()

  return () => {
    aborted = true
    if (timer) window.clearTimeout(timer)
  }
}
