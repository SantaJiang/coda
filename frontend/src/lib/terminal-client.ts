import { listTerminals, terminalControl, terminalLog, terminalStreamURL } from "./api"
import {
  parseTerminalInfo,
  parseTerminalLog,
  type TerminalAction,
  type TerminalInfo,
  type TerminalLog,
} from "./terminal-contracts"

export interface TerminalClient {
  list(directory: string, sessionID: string): Promise<{ backendID: string; items: TerminalInfo[] }>
  control(directory: string, sessionID: string, id: string, action: TerminalAction): Promise<unknown>
  log(directory: string, sessionID: string, id: string, cursor?: number, limit?: number): Promise<TerminalLog>
  subscribe(
    directory: string,
    sessionID: string,
    id: string,
    cursor: number,
    onFrame: (frame: TerminalLog) => void,
    onError: (message: string) => void,
  ): () => void
}

export function subscribeTerminal(
  url: (cursor: number) => string,
  cursor: number,
  onFrame: (frame: TerminalLog) => void,
  onError: (message: string) => void,
) {
  const abort = new AbortController()
  void (async () => {
    while (!abort.signal.aborted) {
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
      try {
        const response = await fetch(url(cursor), { signal: abort.signal })
        if (!response.ok || !response.body) throw new Error(`终端连接失败 (${response.status})`)
        onError("")
        reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        while (!abort.signal.aborted) {
          const part = await reader.read()
          if (abort.signal.aborted) return
          buffer += part.done ? decoder.decode() : decoder.decode(part.value, { stream: true })
          buffer = buffer.replace(/\r\n/g, "\n")
          const frames = buffer.split("\n\n")
          buffer = part.done ? "" : (frames.pop() ?? "")
          for (const frame of frames) {
            const data = frame
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart())
              .join("\n")
            if (!data) continue
            const value = parseTerminalLog(JSON.parse(data))
            onFrame(value)
            cursor = value.cursor
            if (value.ended) return
          }
          if (part.done) break
        }
      } catch (error) {
        if (abort.signal.aborted) return
        onError(error instanceof Error ? error.message : "终端断开，正在重新连接")
      } finally {
        try {
          await reader?.cancel()
        } catch {
          /* The server may already have closed the stream. */
        }
        reader?.releaseLock()
      }
      if (abort.signal.aborted) return
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer)
          abort.signal.removeEventListener("abort", finish)
          resolve()
        }
        const timer = setTimeout(finish, 1500)
        abort.signal.addEventListener("abort", finish, { once: true })
        if (abort.signal.aborted) finish()
      })
    }
  })()
  return () => abort.abort()
}

export const defaultTerminalClient: TerminalClient = {
  list: async (...args) => {
    const value = await listTerminals(...args)
    if (!value || typeof value.backendID !== "string" || !Array.isArray(value.items))
      throw new Error("终端列表格式无效")
    return { ...value, items: value.items.map(parseTerminalInfo) }
  },
  control: (...args) => terminalControl(...args),
  log: async (...args) => parseTerminalLog(await terminalLog(...args)),
  subscribe: (directory, sessionID, id, cursor, onFrame, onError) =>
    subscribeTerminal((at) => terminalStreamURL(directory, sessionID, id, at), cursor, onFrame, onError),
}
