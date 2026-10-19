import { produce } from "solid-js/store"
import { ascendingID } from "../lib/uid"
import { upsertById } from "../lib/upsert"
import type { Part, UserMessage } from "../lib/types"
import type { StoreHandle } from "./handle"
import type { OutgoingPrompt } from "./state"

export function stageOutgoing(handle: StoreHandle, payload: Omit<OutgoingPrompt, "messageID" | "partIDs">, previous?: OutgoingPrompt) {
  const item: OutgoingPrompt = previous ?? { ...payload, messageID: ascendingID("msg"), partIDs: Array.from({ length: (payload.text.trim() ? 1 : 0) + payload.files.length }, () => ascendingID("prt")) }
  const parts: Part[] = []
  const base = { sessionID: item.sessionID, messageID: item.messageID }
  if (item.text.trim()) parts.push({ ...base, id: item.partIDs[parts.length], type: "text", text: item.text })
  for (const file of item.files) parts.push({ ...base, id: item.partIDs[parts.length], type: "file", filename: file.filename, mime: file.mime, url: file.url })
  const message: UserMessage = { sessionID: item.sessionID, id: item.messageID, role: "user", delivery: "sending", time: { created: Date.now() }, agent: item.agent, model: item.model }
  handle.setState(produce((draft) => {
    const old = (draft.messages[item.sessionID] ?? []).find((message) => message.id === item.messageID)
    draft.messages[item.sessionID] = upsertById(draft.messages[item.sessionID] ?? [], { ...message, time: old?.time ?? message.time })
    draft.parts[item.messageID] = parts
    draft.outgoing[item.messageID] = item
    delete draft.stoppedTurns[item.messageID]
    if (draft.stoppedTurnBySession[item.sessionID] === item.messageID) delete draft.stoppedTurnBySession[item.sessionID]
    delete draft.sessionErrorText[item.sessionID]
  }))
  return item
}

export function moveOutgoingSession(handle: StoreHandle, from: string, to: string) {
  handle.setState(produce((draft) => {
    const messages = draft.messages[from] ?? []
    draft.messages[to] = messages.map((message) => ({ ...message, sessionID: to }))
    for (const message of messages) draft.parts[message.id] = (draft.parts[message.id] ?? []).map((part) => ({ ...part, sessionID: to }))
    for (const item of Object.values(draft.outgoing)) if (item.sessionID === from) item.sessionID = to
    if (draft.timelineViews[from]) draft.timelineViews[to] = draft.timelineViews[from]
    delete draft.messages[from]
    delete draft.timelineViews[from]
  }))
}

export function outgoingDelivery(handle: StoreHandle, item: OutgoingPrompt, delivery?: UserMessage["delivery"], error?: string) {
  handle.setState(produce((draft) => {
    const message = (draft.messages[item.sessionID] ?? []).find((message) => message.id === item.messageID)
    if (message?.role !== "user") return
    message.delivery = delivery
    message.deliveryError = error
    if (!delivery) delete draft.outgoing[item.messageID]
  }))
}
