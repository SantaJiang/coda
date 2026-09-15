import type { Message, Part, ReasoningPart, SessionStatus, TextPart } from "./types"

function preferMessage(local: Message, incoming: Message): Message {
  if (local.role !== "assistant" || incoming.role !== "assistant") return incoming
  const localDone = Boolean(local.time.completed) || Boolean(local.error)
  const incomingDone = Boolean(incoming.time.completed) || Boolean(incoming.error)
  if (localDone && !incomingDone) return local
  return incoming
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
    if (!seen.has(item.id) && item.time.created >= newestIncoming) merged.push(item)
  }
  return merged
}

function preferPart(local: Part, incoming: Part): Part {
  if (incoming.type === "reasoning" && local.type === "reasoning") {
    const localText = local.text ?? ""
    const incomingText = incoming.text ?? ""
    const localDone = Number.isFinite(Number(local.time?.end))
    const incomingDone = Number.isFinite(Number(incoming.time?.end))
    const time = localDone && !incomingDone ? local.time : (incoming.time ?? local.time)
    return {
      ...incoming,
      text: localText.length > incomingText.length ? localText : incomingText,
      ...(time ? { time } : {}),
    } satisfies ReasoningPart
  }
  if (incoming.type === "text" && local.type === "text") {
    const localText = (local as TextPart).text ?? ""
    const incomingText = (incoming as TextPart).text ?? ""
    if (localText.length > incomingText.length) return local
  }
  if (incoming.type === "tool" && local.type === "tool") {
    const localDone = local.state.status === "completed" || local.state.status === "error"
    const incomingDone = incoming.state.status === "completed" || incoming.state.status === "error"
    if (localDone && !incomingDone) return local
  }
  return incoming
}

export function mergeParts(local: Part[], incoming: Part[]): Part[] {
  const localById = new Map(local.map((item) => [item.id, item]))
  const merged = incoming.map((item) => {
    const prev = localById.get(item.id)
    return prev ? preferPart(prev, item) : item
  })
  const seen = new Set(incoming.map((item) => item.id))
  for (const item of local) {
    if (!seen.has(item.id)) merged.push(item)
  }
  return merged
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
  const settled = derived?.type === "idle" && lastRole !== "user"
  if (live) {
    const fromLive = live[sessionID] ?? { type: "idle" as const }
    if (settled && fromLive.type !== "idle") return { type: "idle" as const }
    return fromLive
  }
  if (settled) return derived ?? { type: "idle" as const }
  return applyDerivedStatus(current, derived, merge)
}

export function resolveRacingSessionStatus(
  current: SessionStatus | undefined,
  derived: SessionStatus | null,
  lastRole?: Message["role"],
): SessionStatus | undefined {
  if (derived?.type === "idle" && lastRole !== "user") return derived
  return current ?? derived ?? undefined
}
