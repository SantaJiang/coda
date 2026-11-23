import type { ClientMcpTool } from "./client-mcp"

const KEY = "coda.mcp.notes"
const MAX_ENTRIES = 100
const MAX_TEXT = 20_000

type Notes = Record<string, string>

const storageKey = (directory: string) => `${KEY}:${directory}`

export function readNotes(directory: string, read: (key: string) => string | null = (key) => localStorage.getItem(key)): Notes {
  try {
    const parsed = JSON.parse(read(storageKey(directory)) ?? "{}") as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    const result: Notes = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (key && typeof value === "string") result[key] = value
    }
    return result
  } catch {
    return {}
  }
}

export function writeNotes(
  directory: string,
  notes: Notes,
  write: (key: string, value: string) => void = (key, value) => localStorage.setItem(key, value),
) {
  const entries = Object.entries(notes).slice(-MAX_ENTRIES)
  write(storageKey(directory), JSON.stringify(Object.fromEntries(entries)))
}

/** Client-hosted tools give the backend a durable place for agent notes without a server-side memory feature. */
export function noteTools(
  directory: string,
  storage?: { read: (key: string) => string | null; write: (key: string, value: string) => void },
): ClientMcpTool[] {
  const read = (key: string) => (storage ? storage.read(key) : localStorage.getItem(key))
  const write = (key: string, value: string) => {
    if (storage) storage.write(key, value)
    else localStorage.setItem(key, value)
  }
  return [
    {
      name: "coda_remember",
      description: "把一条项目笔记存到本机，后续会话可以通过 coda_recall 取回。",
      inputSchema: {
        type: "object",
        properties: {
          key: { type: "string", description: "笔记名称" },
          text: { type: "string", description: "笔记内容" },
        },
        required: ["key", "text"],
      },
      run: async ({ key, text }) => {
        const name = typeof key === "string" ? key.trim() : ""
        const value = typeof text === "string" ? text.slice(0, MAX_TEXT) : ""
        if (!name || !value) return "需要提供 key 和 text"
        const notes = readNotes(directory, read)
        notes[name] = value
        writeNotes(directory, notes, write)
        return `已记住 ${name}`
      },
    },
    {
      name: "coda_recall",
      description: "读取本机项目笔记。给 key 时读一条，不给时列出全部。",
      inputSchema: {
        type: "object",
        properties: { key: { type: "string", description: "笔记名称，留空列出全部" } },
      },
      run: async ({ key }) => {
        const notes = readNotes(directory, read)
        if (typeof key === "string" && key.trim()) return notes[key.trim()] ?? `没有名为 ${key.trim()} 的笔记`
        const entries = Object.entries(notes)
        if (!entries.length) return "还没有笔记"
        return entries.map(([name, text]) => `## ${name}\n${text}`).join("\n\n")
      },
    },
  ]
}
