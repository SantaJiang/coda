import type { AssistantError, Message, PermissionRequest, QuestionRequest, SessionStatus } from "./types"

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

export function formatSessionErrorMessage(raw?: string | null) {
  if (!raw) return ""
  let text = raw.trim()
  const wrapped = text.match(/^Cause\(\[Die\(([\s\S]+)\)\]\)$/)
  if (wrapped?.[1]) text = wrapped[1].trim()
  return text
}

export function isAbortError(error?: AssistantError | string | null) {
  if (!error) return false
  if (typeof error === "string") return error.trim().toLowerCase() === "aborted"
  const name = (error.name ?? "").toLowerCase()
  if (name === "messageabortederror" || name === "aborterror") return true
  return (error.data?.message ?? "").trim().toLowerCase() === "aborted"
}

export function hasFailingAssistant(messages: Message[]): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== "assistant") continue
    return Boolean(message.error) && !isAbortError(message.error)
  }
  return false
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
