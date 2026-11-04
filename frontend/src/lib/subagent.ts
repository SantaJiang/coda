import type { MessageWithParts, Part, Session, ToolPart } from "./types"

/** Cursor Task / OpenCode subagent tool names. */
export function isSubagentTool(part: Part): part is ToolPart {
  if (part.type !== "tool") return false
  const name = part.tool.toLowerCase()
  return name === "subagent" || name === "task"
}

export function subagentDescription(part: ToolPart) {
  const input = part.state.input ?? {}
  const fromInput = String(input.description ?? "").trim()
  if (fromInput) return fromInput
  const title = "title" in part.state ? String(part.state.title ?? "").trim() : ""
  return title
}

/** Child session id from tool metadata or completed `<subagent sessionID="…">` output. */
export function subagentSessionID(part: ToolPart): string | undefined {
  const meta = "metadata" in part.state ? part.state.metadata : undefined
  const fromMeta = meta && typeof meta.sessionID === "string" ? meta.sessionID.trim() : ""
  if (fromMeta) return fromMeta
  const output = part.state.status === "completed" ? String(part.state.output ?? "") : ""
  const match = output.match(/<subagent\b[^>]*\bsessionID="([^"]+)"/i)
  return match?.[1]?.trim() || undefined
}

export function subagentRunning(part: ToolPart) {
  return part.state.status === "pending" || part.state.status === "running"
}

export type SubagentActivity = {
  key: string
  sessionID?: string
  label: string
  agent?: string
  started: number
  running: boolean
}

export function subagentActivities(messages: MessageWithParts[]): SubagentActivity[] {
  const items: SubagentActivity[] = []
  for (const message of messages) {
    for (const part of message.parts) {
      if (!isSubagentTool(part)) continue
      const label = subagentDescription(part) || "Subagent"
      const agent = typeof part.state.input?.agent === "string" ? part.state.input.agent : undefined
      const started =
        ("time" in part.state && typeof part.state.time?.start === "number" ? part.state.time.start : undefined) ??
        message.info.time.created
      items.push({
        key: part.id,
        sessionID: subagentSessionID(part),
        label,
        agent,
        started,
        running: subagentRunning(part),
      })
    }
  }
  return items
}

export function runningSubagentActivities(messages: MessageWithParts[]) {
  return subagentActivities(messages).filter((item) => item.running)
}

/** Build a selectable child Session stub when the list cache has not hydrated it yet. */
export function childSessionStub(input: {
  id: string
  directory: string
  title: string
  parentID: string
  agent?: string
}): Session {
  const now = Date.now()
  return {
    id: input.id,
    directory: input.directory,
    title: input.title,
    parentID: input.parentID,
    ...(input.agent ? { agent: input.agent } : {}),
    time: { created: now, updated: now },
  }
}
