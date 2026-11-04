import type { Message, Part, ReasoningPart, SessionStatus, TextPart } from "./types"

export function preferMessage(local: Message, incoming: Message): Message {
  if (local.role !== "assistant" || incoming.role !== "assistant") return incoming
  const localDone = Boolean(local.time.completed) || Boolean(local.error)
  const incomingDone = Boolean(incoming.time.completed) || Boolean(incoming.error)
  if (localDone && !incomingDone) return local
  const created = Math.min(local.time.created, incoming.time.created)
  return { ...incoming, finish: incoming.finish ?? local.finish, time: { ...incoming.time, created } }
}

export function mergeMessages(local: Message[], incoming: Message[]): Message[] {
  if (incoming.length === 0) return local
  const localById = new Map(local.map((item) => [item.id, item]))
  const merged = incoming.map((item) => {
    const prev = localById.get(item.id)
    return prev ? preferMessage(prev, item) : item
  })
  const seen = new Set(incoming.map((item) => item.id))
  const newestIncoming = incoming.reduce((max, item) => Math.max(max, item.time.created), 0)
  for (const item of local) {
    if (!seen.has(item.id) && (item.time.created >= newestIncoming || (item.role === "user" && item.delivery))) merged.push(item)
  }
  return merged.sort((a, b) => a.time.created - b.time.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function proseText(part: Part) {
  if (part.type === "text" || part.type === "reasoning") return part.text ?? ""
  return ""
}

function preferPart(local: Part, incoming: Part): Part {
  const bothProse =
    (local.type === "text" || local.type === "reasoning") &&
    (incoming.type === "text" || incoming.type === "reasoning")
  if (bothProse && local.type !== incoming.type) {
    const localText = proseText(local)
    const incomingText = proseText(incoming)
    return { ...incoming, text: localText.length > incomingText.length ? localText : incomingText }
  }
  if (incoming.type === "reasoning" && local.type === "reasoning") {
    const localText = local.text ?? ""
    const incomingText = incoming.text ?? ""
    const localDone = Number.isFinite(Number(local.time?.end))
    const incomingDone = Number.isFinite(Number(incoming.time?.end))
    const start = local.time?.start ?? incoming.time?.start
    const end = incoming.time?.end ?? local.time?.end
    const time = localDone && !incomingDone ? local.time : start !== undefined || end !== undefined ? { ...(start !== undefined ? { start } : {}), ...(end !== undefined ? { end } : {}) } : undefined
    return {
      ...incoming,
      text: localText.length > incomingText.length ? localText : incomingText,
      ...(time ? { time } : {}),
    } satisfies ReasoningPart
  }
  if (incoming.type === "text" && local.type === "text") {
    const localText = (local as TextPart).text ?? ""
    const incomingText = (incoming as TextPart).text ?? ""
    if (localText.length > incomingText.length) return { ...incoming, text: localText }
  }
  if (incoming.type === "tool" && local.type === "tool") {
    const localDone = local.state.status === "completed" || local.state.status === "error"
    const incomingDone = incoming.state.status === "completed" || incoming.state.status === "error"
    if (localDone && !incomingDone) return local
    const incomingInput = "input" in incoming.state ? incoming.state.input : undefined
    const localInput = "input" in local.state ? local.state.input : undefined
    const input = incomingInput ?? localInput
    const kept = { ...incoming, tool: incoming.tool || local.tool, callID: incoming.callID || local.callID }
    if (!input || typeof input === "string") return kept
    return { ...kept, state: { ...incoming.state, input } }
  }
  return incoming
}

/** Collapse adjacent identical text clones (optimistic id + server id for the same body). */
export function dedupeAdjacentIdenticalText(parts: Part[]): Part[] {
  const out: Part[] = []
  for (const part of parts) {
    const prev = out[out.length - 1]
    if (
      part.type === "text" &&
      prev?.type === "text" &&
      prev.messageID === part.messageID &&
      prev.text === part.text
    ) {
      // Keep the later copy — usually the acknowledged server part appended after local.
      out[out.length - 1] = part
      continue
    }
    out.push(part)
  }
  return out
}

export function mergeParts(local: Part[], incoming: Part[]): Part[] {
  const incomingById = new Map(incoming.map((item) => [item.id, item]))
  const merged = local.map((item) => incomingById.has(item.id) ? preferPart(item, incomingById.get(item.id)!) : item)
  const seen = new Set(local.map((item) => item.id))
  for (const item of incoming) if (!seen.has(item.id)) merged.push(item)
  // Production IDs encode creation order. An update must never move a tool ahead of earlier prose.
  if (merged.every((part) => /^prt_[0-9a-f]{12}/.test(part.id))) merged.sort((a, b) => a.id.localeCompare(b.id))
  return dedupeAdjacentIdenticalText(merged)
}

export function applyDerivedStatus(
  current: SessionStatus | undefined,
  derived: SessionStatus | null,
  merge = false,
): SessionStatus | undefined {
  if (!derived) return current
  if (merge && current?.type === "idle" && derived.type === "busy") return current
  return derived
}

export function resolveSessionStatus(
  sessionID: string,
  live: Record<string, SessionStatus> | null,
  current: SessionStatus | undefined,
  derived: SessionStatus | null,
  merge = false,
  lastRole?: Message["role"],
) {
  if (live) {
    const fromLive = live[sessionID] ?? { type: "idle" as const }
    return fromLive
  }
  // Message completion only closes an individual model step, never an active run.
  if (current?.type === "busy" || current?.type === "retry") return current
  if (derived?.type === "idle" && lastRole !== "user") return derived
  return applyDerivedStatus(current, derived, merge)
}

export function resolveRacingSessionStatus(
  current: SessionStatus | undefined,
  derived: SessionStatus | null,
  lastRole?: Message["role"],
): SessionStatus | undefined {
  void lastRole
  return current ?? derived ?? undefined
}
