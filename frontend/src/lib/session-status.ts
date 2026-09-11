import type { Message, PermissionRequest, QuestionRequest, SessionStatus } from "./types"

export function isActiveStatus(status?: SessionStatus) {
  return status?.type === "busy" || status?.type === "retry"
}

export function isSessionBusy(status?: SessionStatus, sending = false) {
  return sending || isActiveStatus(status)
}

export function deriveStatusFromMessages(messages: Message[]): SessionStatus | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== "assistant") continue
    const done = Boolean(message.time.completed) || Boolean(message.error)
    return done ? { type: "idle" } : { type: "busy" }
  }
  return null
}

export function hasAssistantError(messages: Message[]): boolean {
  return messages.some((message) => message.role === "assistant" && Boolean(message.error))
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
