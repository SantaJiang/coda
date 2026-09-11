import type { Message, Part, SessionStatus, TextPart } from "./types"

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
  if ((incoming.type === "text" || incoming.type === "reasoning") && local.type === incoming.type) {
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
