import { mergeMessages, mergeParts, resolveRacingSessionStatus, resolveSessionStatus } from "../lib/session-sync"
import { deriveStatusFromMessages, hasFailingAssistant } from "../lib/session-status"
import type { Message, Part, Session } from "../lib/types"
import { inferPlanMode } from "./handle"
import type { SessionReader } from "./ports"
import type { AppState } from "./state"

type SnapshotState = Pick<
  AppState,
  | "messages"
  | "parts"
  | "status"
  | "todos"
  | "permissions"
  | "questions"
  | "outgoing"
  | "sessionErrors"
  | "sessionErrorText"
  | "planModeBySession"
  | "stoppingBySession"
  | "stoppedTurnBySession"
  | "stoppedTurns"
  | "settlingBySession"
  | "removedSessions"
  | "sessionEpoch"
  | "eventRevision"
  | "removedMessages"
  | "removedParts"
>

type Listed<T> = { ok: true; value: T } | { ok: false }

function listed<T>(promise: Promise<T>): Promise<Listed<T>> {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    () => ({ ok: false as const }),
  )
}

function statusKey(status: ReturnType<typeof deriveStatusFromMessages> | undefined) {
  if (!status) return ""
  return `${status.type}:${status.type === "retry" ? `${status.attempt ?? ""}:${status.next ?? ""}` : ""}`
}

function hashValue(value: unknown) {
  if (value === undefined) return "0"
  let raw: string
  try {
    raw = JSON.stringify(value) ?? ""
  } catch {
    return "-1"
  }
  let hash = 5381
  for (let index = 0; index < raw.length; index += 1) {
    hash = ((hash << 5) + hash + raw.charCodeAt(index)) | 0
  }
  return `${raw.length}:${hash}`
}

function partKey(part: Part) {
  if (part.type === "text") return `${part.id}:text:${hashValue(part.text)}`
  if (part.type === "reasoning") {
    return `${part.id}:reasoning:${hashValue(part.text)}:${part.time?.start ?? ""}:${part.time?.end ?? ""}`
  }
  if (part.type === "tool") {
    const state = part.state
    const title = "title" in state ? (state.title ?? "") : ""
    const metadata = "metadata" in state ? state.metadata : undefined
    const output = state.status === "completed" ? hashValue(state.output) : "0"
    const error = state.status === "error" ? hashValue(state.error) : "0"
    const time = "time" in state ? state.time : undefined
    const end = time && "end" in time ? (time.end ?? "") : ""
    return `${part.id}:tool:${state.status}:${hashValue(title)}:${hashValue(state.input)}:${hashValue(metadata)}:${output}:${error}:${end}`
  }
  return `${part.id}:${part.type}`
}

function sessionSnapshotKey(
  status: ReturnType<typeof deriveStatusFromMessages> | undefined,
  messages: Message[],
  parts: Record<string, Part[]>,
) {
  const content = messages.map((message) => {
    const completed = message.role === "assistant" ? (message.time.completed ?? "") : ""
    const info = `${message.id}:${message.role}:${completed}:${Boolean(message.role === "assistant" && message.error)}`
    return `${info}[${(parts[message.id] ?? []).map(partKey).join(",")}]`
  })
  return `${statusKey(status)}|${content.join("|")}`
}

export function captureSessionSnapshot(state: SnapshotState, sessionID: string) {
  const beforeMessages = state.messages[sessionID] ?? []
  const beforeMessageIds = new Set(beforeMessages.map((item) => item.id))
  return {
    epoch: state.sessionEpoch[sessionID] ?? 0,
    beforeMessageIds,
    beforePartIds: new Map(
      [...beforeMessageIds].map((id) => [id, new Set((state.parts[id] ?? []).map((part) => part.id))]),
    ),
    beforePermissionIds: new Set(
      Object.values(state.permissions)
        .filter((item) => item.sessionID === sessionID)
        .map((item) => item.id),
    ),
    beforeQuestionIds: new Set(
      Object.values(state.questions)
        .filter((item) => item.sessionID === sessionID)
        .map((item) => item.id),
    ),
    todoListBefore: state.todos[sessionID],
    todosBefore: JSON.stringify(state.todos[sessionID] ?? []),
    snapshotBefore: sessionSnapshotKey(state.status[sessionID], beforeMessages, state.parts),
    revisionBefore: state.eventRevision[sessionID] ?? 0,
  }
}

// Details tolerate unavailable auxiliary endpoints; idle boundaries require a complete snapshot.
export async function readSessionSnapshot(client: SessionReader, directory: string, sessionID: string, strict = false) {
  const optional = <T>(promise: Promise<T>): Promise<Listed<T>> =>
    strict ? promise.then((value) => ({ ok: true as const, value })) : listed(promise)
  const [messages, todos, permissions, questions, statuses] = await Promise.all([
    client.listMessages(directory, sessionID),
    optional(client.listTodos(directory, sessionID)),
    optional(client.listPermissions(directory)),
    optional(client.listQuestions(directory)),
    optional(client.listSessionStatuses(directory)),
  ])
  return { messages, todos, permissions, questions, statuses }
}

export function applySessionSnapshot(
  draft: SnapshotState,
  sessionID: string,
  before: ReturnType<typeof captureSessionSnapshot>,
  result: Awaited<ReturnType<typeof readSessionSnapshot>>,
  opts: { mode: "detail" | "idle"; merge?: boolean; session?: Session; todoListUnchanged: boolean },
) {
  if (draft.removedSessions[sessionID] || (draft.sessionEpoch[sessionID] ?? 0) !== before.epoch) return
  const {
    beforeMessageIds,
    beforePartIds,
    beforePermissionIds,
    beforeQuestionIds,
    todosBefore,
    snapshotBefore,
    revisionBefore,
  } = before
  const { messages, todos, permissions, questions, statuses } = result
  const todoListUnchanged = opts.todoListUnchanged
  const localMessages = draft.messages[sessionID] ?? []
  const removedMessages = new Set([...beforeMessageIds].filter((id) => !localMessages.some((item) => item.id === id)))
  const infos = messages
    .map((item) => item.info)
    .filter((info) => !removedMessages.has(info.id) && !draft.removedMessages[info.id])
  const stateUnchanged =
    (draft.eventRevision[sessionID] ?? 0) === revisionBefore &&
    sessionSnapshotKey(draft.status[sessionID], localMessages, draft.parts) === snapshotBefore
  const shouldMerge = opts.mode === "idle" || Boolean(opts.merge) || !stateUnchanged
  const nextMessages = shouldMerge ? mergeMessages(localMessages, infos) : infos
  draft.messages[sessionID] = nextMessages
  for (const item of messages) {
    if (removedMessages.has(item.info.id) || draft.removedMessages[item.info.id]) {
      delete draft.parts[item.info.id]
      continue
    }
    if (item.info.role === "user") delete draft.outgoing[item.info.id]
    const knownParts = beforePartIds.get(item.info.id)
    const currentParts = draft.parts[item.info.id] ?? []
    const incomingParts = (item.parts ?? []).filter((part) => {
      if (draft.removedParts[`${part.messageID}:${part.id}`]) return false
      if (!knownParts?.has(part.id)) return true
      return currentParts.some((entry) => entry.id === part.id)
    })
    draft.parts[item.info.id] = shouldMerge ? mergeParts(currentParts, incomingParts) : incomingParts
  }
  if (todos.ok && todoListUnchanged && JSON.stringify(draft.todos[sessionID] ?? []) === todosBefore)
    draft.todos[sessionID] = todos.value ?? []
  const fromMessages = deriveStatusFromMessages(nextMessages)
  const lastRole = nextMessages[nextMessages.length - 1]?.role
  const derived =
    opts.mode === "idle"
      ? stateUnchanged && statuses.ok
        ? (statuses.value?.[sessionID] ?? { type: "idle" as const })
        : draft.status[sessionID]
      : stateUnchanged
        ? resolveSessionStatus(
            sessionID,
            statuses.ok ? (statuses.value ?? null) : null,
            draft.status[sessionID],
            fromMessages,
            Boolean(opts.merge),
            lastRole,
          )
        : resolveRacingSessionStatus(draft.status[sessionID], fromMessages, lastRole)
  if (derived) draft.status[sessionID] = derived
  const failing = hasFailingAssistant(nextMessages)
  draft.sessionErrors[sessionID] = failing
  const latestAssistant = [...nextMessages].reverse().find((item) => item.role === "assistant")
  const latestUser = [...nextMessages].reverse().find((item) => item.role === "user")
  if (
    !failing &&
    latestAssistant?.role === "assistant" &&
    latestAssistant.time.completed &&
    (!latestUser ||
      latestAssistant.parentID === latestUser.id ||
      (!latestAssistant.parentID && latestAssistant.time.created >= latestUser.time.created))
  ) {
    delete draft.sessionErrorText[sessionID]
  }
  if (draft.planModeBySession[sessionID] === undefined) {
    draft.planModeBySession[sessionID] = inferPlanMode(opts.session, nextMessages)
  }
  if (permissions.ok) {
    const removed = new Set([...beforePermissionIds].filter((id) => !draft.permissions[id]))
    const incoming = (permissions.value ?? []).filter((item) => item.sessionID === sessionID && !removed.has(item.id))
    const incomingIds = new Set(incoming.map((item) => item.id))
    for (const id of beforePermissionIds) {
      if (draft.permissions[id] && !incomingIds.has(id)) delete draft.permissions[id]
    }
    for (const item of incoming) draft.permissions[item.id] = item
  }
  if (questions.ok) {
    const removed = new Set([...beforeQuestionIds].filter((id) => !draft.questions[id]))
    const incoming = (questions.value ?? []).filter((item) => item.sessionID === sessionID && !removed.has(item.id))
    const incomingIds = new Set(incoming.map((item) => item.id))
    for (const id of beforeQuestionIds) {
      if (draft.questions[id] && !incomingIds.has(id)) delete draft.questions[id]
    }
    for (const item of incoming) draft.questions[item.id] = item
  }
  if (opts.mode === "idle") {
    if (draft.status[sessionID]?.type === "idle" && draft.stoppingBySession[sessionID]) {
      const user = [...(draft.messages[sessionID] ?? [])]
        .reverse()
        .find(
          (message) =>
            message.role === "user" && !(draft.parts[message.id] ?? []).some((part) => part.type === "compaction"),
        )
      if (user) {
        draft.stoppedTurnBySession[sessionID] = user.id
        draft.stoppedTurns[user.id] = true
      }
      delete draft.stoppingBySession[sessionID]
    }
    delete draft.settlingBySession[sessionID]
  }
}
