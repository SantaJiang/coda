import { produce } from "solid-js/store"
import { mergeMessages, mergeParts } from "../lib/session-sync"
import { syncSessionRequests } from "./gc"
import type { StoreHandle } from "./handle"

/** Reconcile the idle boundary before allowing final grouping or queue advancement. */
export async function reconcileSession(handle: StoreHandle, sessionID: string, directory: string) {
  const { state, setState, client } = handle
  const revision = state.eventRevision[sessionID] ?? 0
  const before = state.messages[sessionID] ?? []
  const partIDs = new Map(before.map((message) => [message.id, new Set((state.parts[message.id] ?? []).map((part) => part.id))]))
  const permissionIDs = new Set(Object.values(state.permissions).filter((item) => item.sessionID === sessionID).map((item) => item.id))
  const questionIDs = new Set(Object.values(state.questions).filter((item) => item.sessionID === sessionID).map((item) => item.id))
  const [messages, statuses, permissions, questions] = await Promise.all([
    client.listMessages(directory, sessionID), client.listSessionStatuses(directory),
    client.listPermissions(directory), client.listQuestions(directory),
  ])
  setState(produce((draft) => {
    const local = draft.messages[sessionID] ?? []
    const removed = new Set(before.filter((message) => !local.some((item) => item.id === message.id)).map((message) => message.id))
    const incoming = (messages ?? []).filter((item) => !removed.has(item.info.id) && !draft.removedMessages[item.info.id])
    draft.messages[sessionID] = mergeMessages(local, incoming.map((item) => item.info))
    for (const item of incoming) {
      const current = draft.parts[item.info.id] ?? []
      const known = partIDs.get(item.info.id)
      draft.parts[item.info.id] = mergeParts(current, (item.parts ?? []).filter((part) => !draft.removedParts[`${part.messageID}:${part.id}`] && (!known?.has(part.id) || current.some((prev) => prev.id === part.id))))
      if (item.info.role === "user") delete draft.outgoing[item.info.id]
    }
    // Only a snapshot taken without intervening events may replace live session status.
    if ((draft.eventRevision[sessionID] ?? 0) === revision) draft.status[sessionID] = statuses?.[sessionID] ?? { type: "idle" }
    const nextPermissions = (permissions ?? []).filter((item) => !permissionIDs.has(item.id) || draft.permissions[item.id])
    const nextQuestions = (questions ?? []).filter((item) => !questionIDs.has(item.id) || draft.questions[item.id])
    // Preserve new requests that arrived after the snapshot started.
    nextPermissions.push(...Object.values(draft.permissions).filter((item) => item.sessionID === sessionID && !permissionIDs.has(item.id) && !nextPermissions.some((incoming) => incoming.id === item.id)))
    nextQuestions.push(...Object.values(draft.questions).filter((item) => item.sessionID === sessionID && !questionIDs.has(item.id) && !nextQuestions.some((incoming) => incoming.id === item.id)))
    syncSessionRequests(draft, sessionID, nextPermissions, nextQuestions)
    if (draft.status[sessionID]?.type === "idle" && draft.stoppingBySession[sessionID]) {
      const user = [...draft.messages[sessionID]].reverse().find((message) => message.role === "user" && !(draft.parts[message.id] ?? []).some((part) => part.type === "compaction"))
      if (user) {
        draft.stoppedTurnBySession[sessionID] = user.id
        draft.stoppedTurns[user.id] = true
      }
      delete draft.stoppingBySession[sessionID]
    }
    delete draft.settlingBySession[sessionID]
  }))
}
