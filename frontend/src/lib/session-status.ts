import type { PermissionRequest, QuestionRequest, SessionStatus } from "./types"

export function isActiveStatus(status?: SessionStatus) {
  return status?.type === "busy" || status?.type === "retry"
}

export function isSessionBusy(status?: SessionStatus, sending = false) {
  return sending || isActiveStatus(status)
}

export function sessionHasBlockers(
  sessionID: string,
  permissions: Record<string, PermissionRequest | undefined>,
  questions: Record<string, QuestionRequest | undefined>,
) {
  return (
    Object.values(permissions).some((item) => item?.sessionID === sessionID) ||
    Object.values(questions).some((item) => item?.sessionID === sessionID)
  )
}

export type SessionDot = "wait" | "error" | "busy" | "unread"

export function sessionDotKind(input: {
  sessionID: string
  permissions: Record<string, PermissionRequest | undefined>
  questions: Record<string, QuestionRequest | undefined>
  sessionErrors: Record<string, boolean | undefined>
  status?: SessionStatus
  attention?: boolean
}): SessionDot | null {
  if (sessionHasBlockers(input.sessionID, input.permissions, input.questions)) return "wait"
  if (input.sessionErrors[input.sessionID]) return "error"
  if (isActiveStatus(input.status)) return "busy"
  if (input.attention) return "unread"
  return null
}
