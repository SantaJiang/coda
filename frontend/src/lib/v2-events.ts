import type { ParsedEvent } from "./events"
import type { AssistantMessage, Part, Session, ToolState } from "./types"
import { formToQuestion } from "./v2-map"

type Wire = {
  id?: string
  type?: string
  directory?: string
  location?: { directory?: string }
  properties?: Record<string, unknown>
  data?: Record<string, unknown>
  payload?: {
    id?: string
    type?: string
    properties?: Record<string, unknown>
    data?: Record<string, unknown>
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join("\n")
  const item = record(value)
  if (!item) return ""
  if (typeof item.text === "string") return item.text
  if ("content" in item) return textOf(item.content)
  return ""
}

function directoryOf(raw: Wire, data: Record<string, unknown>) {
  const location = record(data.location)
  return raw.location?.directory || raw.directory || (typeof location?.directory === "string" ? location.directory : undefined)
}

function sessionFrom(data: Record<string, unknown>, directory?: string): Session {
  const location = record(data.location)
  const model = record(data.model)
  const time = record(data.time)
  const now = Date.now()
  return {
    id: String(data.sessionID ?? data.id ?? ""),
    projectID: typeof data.projectID === "string" ? data.projectID : undefined,
    directory: (typeof location?.directory === "string" ? location.directory : directory) || "",
    parentID: typeof data.parentID === "string" ? data.parentID : undefined,
    title: typeof data.title === "string" && data.title.trim() ? data.title : "新会话",
    agent: typeof data.agent === "string" ? data.agent : undefined,
    ...(model && typeof model.id === "string" && typeof model.providerID === "string"
      ? { model: { id: model.id, providerID: model.providerID, variant: typeof model.variant === "string" ? model.variant : undefined } }
      : {}),
    time: {
      created: typeof time?.created === "number" ? time.created : now,
      updated: typeof time?.updated === "number" ? time.updated : now,
      archived: typeof time?.archived === "number" ? time.archived : undefined,
    },
  }
}

function assistant(messageID: string, sessionID: string): AssistantMessage {
  return { id: messageID, sessionID, role: "assistant", time: { created: Date.now() } }
}

function prose(
  kind: "text" | "reasoning",
  messageID: string,
  sessionID: string,
  ordinal: unknown,
  text: string,
  time?: { start?: number; end?: number },
): Part {
  return {
    id: `${messageID}:${kind}:${String(ordinal ?? 0)}`,
    sessionID,
    messageID,
    type: kind,
    text,
    ...(kind === "reasoning" && time ? { time } : {}),
  }
}

function toolPart(data: Record<string, unknown>, state: ToolState): Part {
  return {
    id: String(data.id ?? ""),
    sessionID: String(data.sessionID ?? ""),
    messageID: String(data.assistantMessageID ?? ""),
    type: "tool",
    callID: String(data.id ?? ""),
    tool: typeof data.name === "string" ? data.name : "",
    state,
  }
}

function event(raw: Wire, type: string, properties: Record<string, unknown>, directory?: string): ParsedEvent {
  // One wire record can produce both a message and a part update. Give each
  // projection its own stable ID so store deduplication keeps both on first use
  // and still drops both when the wire record is replayed.
  return { directory, event: { id: raw.id ? `${raw.id}:${type}` : undefined, type, properties } }
}

/** Turn one v2 SSE record into the events the existing session store already applies. */
export function translateWireEvent(raw: Wire): ParsedEvent[] {
  if (raw.payload?.type) {
    return [{ directory: raw.directory, event: { id: raw.payload.id, type: raw.payload.type, properties: raw.payload.properties, data: raw.payload.data } }]
  }
  const type = raw.type
  if (!type) return []
  const data = raw.data ?? raw.properties ?? {}
  const directory = directoryOf(raw, data)
  const emit = (next: string, properties: Record<string, unknown>) => event(raw, next, properties, directory)
  const sessionID = String(data.sessionID ?? "")
  const messageID = String(data.assistantMessageID ?? "")

  if (type === "session.created") return [emit("session.created", { info: sessionFrom(data, directory) })]
  if (type === "session.renamed") return [emit("session.updated", { sessionID, info: { ...sessionFrom(data, directory), id: sessionID, title: String(data.title ?? "") } })]
  if (type === "session.deleted" || type === "session.status" || type === "session.idle" || type === "permission.replied") {
    return [emit(type, data)]
  }
  if (type === "permission.asked") {
    return [emit(type, {
      id: data.id,
      sessionID,
      permission: data.action ?? data.permission,
      patterns: Array.isArray(data.resources) ? data.resources : Array.isArray(data.patterns) ? data.patterns : [],
      metadata: data.metadata,
      always: data.save,
    })]
  }
  if (type === "session.text.started" || type === "session.reasoning.started") {
    const kind = type === "session.reasoning.started" ? "reasoning" : "text"
    const now = Date.now()
    return [
      emit("message.updated", { info: assistant(messageID, sessionID) }),
      emit("message.part.updated", { part: prose(kind, messageID, sessionID, data.ordinal, "", kind === "reasoning" ? { start: now } : undefined) }),
    ]
  }
  if (type === "session.text.delta" || type === "session.reasoning.delta") {
    const kind = type === "session.reasoning.delta" ? "reasoning" : "text"
    return [emit("message.part.delta", {
      sessionID,
      messageID,
      partID: `${messageID}:${kind}:${String(data.ordinal ?? 0)}`,
      field: "text",
      delta: typeof data.delta === "string" ? data.delta : "",
    })]
  }
  if (type === "session.text.ended" || type === "session.reasoning.ended") {
    const kind = type === "session.reasoning.ended" ? "reasoning" : "text"
    const now = Date.now()
    return [emit("message.part.updated", { part: prose(kind, messageID, sessionID, data.ordinal, typeof data.text === "string" ? data.text : "", kind === "reasoning" ? { end: now } : undefined) })]
  }
  if (type === "session.execution.succeeded" || type === "session.execution.interrupted") {
    return [emit("session.idle", { sessionID })]
  }
  // A runner may resume without a frontend send (for example after a background
  // command). Step starts also restore busy if reconnect missed execution start.
  if (type === "session.execution.started" || type === "session.step.started") {
    return [emit("session.status", { sessionID, status: { type: "busy" } })]
  }
  if (type === "session.tool.input.started") {
    return [
      emit("message.updated", { info: assistant(messageID, sessionID) }),
      emit("message.part.updated", { part: toolPart(data, { status: "pending" }) }),
    ]
  }
  if (type === "session.tool.called" || type === "session.tool.progress") {
    const input = record(data.input)
    return [emit("message.part.updated", { part: toolPart(data, { status: "running", input, metadata: record(data.metadata), time: { start: Date.now() } }) })]
  }
  if (type === "session.tool.success") {
    return [emit("message.part.updated", { part: toolPart(data, { status: "completed", output: textOf(data.content), metadata: record(data.metadata), time: { end: Date.now() } }) })]
  }
  if (type === "session.tool.failed") {
    return [emit("message.part.updated", { part: toolPart(data, { status: "error", error: textOf(data.error) || "工具失败", metadata: record(data.metadata), time: { end: Date.now() } }) })]
  }
  if (type === "form.created") {
    const question = formToQuestion(record(data.form) ?? data)
    return question ? [emit("question.asked", { ...question })] : []
  }
  if (type === "form.replied") return [emit("question.replied", { requestID: data.id, sessionID: data.sessionID })]
  if (type === "form.cancelled") return [emit("question.rejected", { requestID: data.id, sessionID: data.sessionID })]
  if (type === "session.execution.failed" || type === "session.error") {
    return [emit("session.error", { sessionID, error: data.error ?? data })]
  }
  if (type === "session.retry.scheduled") {
    return [emit("session.status", { sessionID, status: { type: "retry", attempt: data.attempt, message: textOf(data.error), next: data.at } })]
  }
  return []
}
