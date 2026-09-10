import { isActiveStatus } from "../lib/session-status"
import type { PermissionRequest, QuestionRequest, SessionStatus } from "../lib/types"
import type { QueuedMessage } from "./state"

export function shouldFlushQueue(input: {
  sending: boolean
  status?: SessionStatus
  permissions: Record<string, PermissionRequest | undefined>
  questions: Record<string, QuestionRequest | undefined>
  sessionID: string
}) {
  if (input.sending) return false
  if (isActiveStatus(input.status)) return false
  if (
    Object.values(input.permissions).some((item) => item?.sessionID === input.sessionID) ||
    Object.values(input.questions).some((item) => item?.sessionID === input.sessionID)
  ) {
    return false
  }
  return true
}

export function takeDeferredSend(
  sendAfterIdle: Record<string, QueuedMessage | undefined>,
  skipQueueFlush: Record<string, boolean>,
  sessionID: string,
) {
  const deferred = sendAfterIdle[sessionID]
  if (deferred) {
    delete sendAfterIdle[sessionID]
    skipQueueFlush[sessionID] = false
    return { kind: "deferred" as const, item: deferred }
  }
  if (skipQueueFlush[sessionID]) {
    skipQueueFlush[sessionID] = false
    return { kind: "skip" as const }
  }
  return { kind: "next" as const }
}
