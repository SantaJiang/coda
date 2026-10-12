import type { AppState } from "./state"
import type { Message, PermissionRequest, QuestionRequest } from "../lib/types"

export function purgeSession(draft: AppState, sessionID: string) {
  const messages: Message[] = draft.messages[sessionID] ?? []
  for (const message of messages) { delete draft.parts[message.id]; delete draft.stoppedTurns[message.id] }
  delete draft.messages[sessionID]
  delete draft.todos[sessionID]
  delete draft.status[sessionID]
  delete draft.attention[sessionID]
  delete draft.sessionErrors[sessionID]
  delete draft.sessionErrorText[sessionID]
  delete draft.queuedBySession[sessionID]
  delete draft.sendingBySession[sessionID]
  delete draft.stoppingBySession[sessionID]
  delete draft.stoppedTurnBySession[sessionID]
  delete draft.syncErrors[sessionID]
  delete draft.settlingBySession[sessionID]
  delete draft.eventRevision[sessionID]
  delete draft.timelineViews[sessionID]
  for (const [id, owner] of Object.entries(draft.removedMessages)) if (owner === sessionID) delete draft.removedMessages[id]
  for (const [id, owner] of Object.entries(draft.removedParts)) if (owner.sessionID === sessionID) delete draft.removedParts[id]
  for (const [id, item] of Object.entries(draft.outgoing)) if (item.sessionID === sessionID) delete draft.outgoing[id]
  delete draft.drafts[`session:${sessionID}`]
  delete draft.planModeBySession[sessionID]
  for (const path of Object.keys(draft.draftSessionsByProject)) {
    const list = draft.draftSessionsByProject[path]
    if (!list?.some((session) => session.id === sessionID)) continue
    draft.draftSessionsByProject[path] = list.filter((session) => session.id !== sessionID)
  }
  for (const [id, permission] of Object.entries(draft.permissions)) {
    if (permission?.sessionID === sessionID) delete draft.permissions[id]
  }
  for (const [id, question] of Object.entries(draft.questions)) {
    if (question?.sessionID === sessionID) delete draft.questions[id]
  }
}

export function syncSessionRequests(
  draft: AppState,
  sessionID: string,
  permissions: PermissionRequest[],
  questions: QuestionRequest[],
  opts: { dropMissing?: boolean } = {},
) {
  const dropMissing = opts.dropMissing !== false
  if (dropMissing) {
    const permIds = new Set(permissions.map((item) => item.id))
    const questionIds = new Set(questions.map((item) => item.id))
    for (const [id, permission] of Object.entries(draft.permissions)) {
      if (permission?.sessionID === sessionID && !permIds.has(id)) delete draft.permissions[id]
    }
    for (const [id, question] of Object.entries(draft.questions)) {
      if (question?.sessionID === sessionID && !questionIds.has(id)) delete draft.questions[id]
    }
  }
  for (const permission of permissions) {
    if (permission.sessionID === sessionID) draft.permissions[permission.id] = permission
  }
  for (const question of questions) {
    if (question.sessionID === sessionID) draft.questions[question.id] = question
  }
}
