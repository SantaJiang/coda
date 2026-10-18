import { autoReplyForMode } from "../lib/permissions"
import { formatSessionErrorMessage, hasFailingAssistant, isAbortError } from "../lib/session-status"
import { mergeParts, preferMessage } from "../lib/session-sync"
import { isLocalProject, missingDirectoryMessage, parseMissingDirectory } from "../lib/persist"
import { samePath } from "../lib/path"
import { upsertById } from "../lib/upsert"
import type {
  AssistantError,
  AssistantMessage,
  Message,
  Part,
  PermissionRequest,
  QuestionRequest,
  Session,
  SessionStatus,
  TextPart,
  Todo,
  ToolPart,
} from "../lib/types"
import type { ParsedEvent } from "../lib/events"
import type { AppState } from "./state"
import { purgeSession } from "./gc"

export type AutoReply = {
  id: string
  reply: "once" | "always" | "reject"
  directory: string
  permission: PermissionRequest
}

export type EventEffects = {
  autoReplies: AutoReply[]
  idleSessions: string[]
}

type EventCtx = {
  props: Record<string, unknown>
  directory?: string
  effects: EventEffects
}

type EventHandler = (draft: AppState, ctx: EventCtx) => void

function ownerPath(draft: AppState, sessionID: string | undefined, rawPath?: string) {
  const owner = draft.projects.find(
    (project) =>
      (rawPath && samePath(project.path, rawPath)) ||
      (sessionID && (draft.sessionsByProject[project.path] ?? []).some((item) => item.id === sessionID)),
  )
  return owner?.path ?? rawPath
}

function asPermission(props: Record<string, unknown>): PermissionRequest | undefined {
  const direct = props as unknown as PermissionRequest
  if (direct?.id) return direct
  return (props.permission ?? props.request ?? props) as PermissionRequest
}

function asQuestion(props: Record<string, unknown>): QuestionRequest | undefined {
  const direct = props as unknown as QuestionRequest
  if (direct?.id) return direct
  return (props.question ?? props.request ?? props) as QuestionRequest
}

function attachSessionError(draft: AppState, sessionID: string, error: AssistantError, message: string) {
  const msgs = draft.messages[sessionID] ?? []
  const user = [...msgs].reverse().find((item) => item.role === "user")
  for (let index = msgs.length - 1; index >= 0; index -= 1) {
    const item = msgs[index]
    if (item.role === "user") break
    if (item.role !== "assistant") continue
    const assistant = item as AssistantMessage
    // 只归因到仍在进行中的那条助手消息（无 error 且未完成）。
    // 若崩溃发生在新助手消息创建之前，上一轮已完成的助手消息不应被误标，
    // 此时回退到会话级错误卡片由时间线底部展示。
    if (!assistant.error && !assistant.time.completed && (!user || assistant.parentID === user.id || (!assistant.parentID && assistant.time.created >= user.time.created))) {
      assistant.error = error
      assistant.time = { ...assistant.time, completed: Date.now() }
      return
    }
  }
  draft.sessionErrorText[sessionID] = message
}

const upsertSession: EventHandler = (draft, { props, directory }) => {
  const info = props.info as Session | undefined
  const sessionID = (props.sessionID as string) ?? info?.id
  if (!info || !sessionID || info.parentID) return
  const path = ownerPath(draft, sessionID, directory || info.directory)
  if (!path) return
  draft.sessionsByProject[path] = upsertById(draft.sessionsByProject[path] ?? [], {
    ...info,
    directory: path,
  })
}

const handlers: Record<string, EventHandler> = {
  "session.created": upsertSession,
  "session.updated": upsertSession,
  "session.deleted": (draft, { props, directory }) => {
    const info = props.info as Session | undefined
    const sessionID = (props.sessionID as string) ?? info?.id
    const path = ownerPath(draft, sessionID, directory || info?.directory)
    if (sessionID && path && draft.sessionsByProject[path]) {
      draft.sessionsByProject[path] = draft.sessionsByProject[path].filter((item) => item.id !== sessionID)
    }
    if (sessionID) purgeSession(draft, sessionID)
    if (sessionID && draft.selectedSessionId === sessionID) {
      draft.selectedSessionId = null
      draft.draft = true
      draft.draftPlanMode = false
    }
  },
  "message.updated": (draft, { props }) => {
    const info = props.info as Message | undefined
    const sessionID = (props.sessionID as string) ?? info?.sessionID
    if (info && sessionID) {
      if (draft.removedMessages[info.id]) return
      const previous = (draft.messages[sessionID] ?? []).find((item) => item.id === info.id)
      draft.messages[sessionID] = upsertById(draft.messages[sessionID] ?? [], previous ? preferMessage(previous, info) : info)
        .sort((a, b) => a.time.created - b.time.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      if (info.role === "user") delete draft.outgoing[info.id]
      const messages = draft.messages[sessionID] ?? []
      if (hasFailingAssistant(messages)) draft.sessionErrors[sessionID] = true
      else delete draft.sessionErrors[sessionID]
      const latest = [...messages].reverse().find((item) => item.role === "assistant")
      const user = [...messages].reverse().find((item) => item.role === "user")
      if (latest?.role === "assistant" && !latest.error && latest.time.completed && (!user || latest.parentID === user.id || (!latest.parentID && latest.time.created >= user.time.created))) {
        delete draft.sessionErrorText[sessionID]
      }
    }
  },
  "message.removed": (draft, { props }) => {
    const sessionID = props.sessionID as string
    const messageID = props.messageID as string
    if (sessionID && messageID) {
      draft.removedMessages[messageID] = sessionID
      delete draft.outgoing[messageID]
      draft.messages[sessionID] = (draft.messages[sessionID] ?? []).filter((item) => item.id !== messageID)
      delete draft.parts[messageID]
    }
  },
  "message.part.updated": (draft, { props }) => {
    const part = props.part as Part | undefined
    if (part && (draft.removedMessages[part.messageID] || draft.removedParts[`${part.messageID}:${part.id}`])) return
    if (part) draft.parts[part.messageID] = mergeParts(draft.parts[part.messageID] ?? [], [part])
  },
  "message.part.removed": (draft, { props }) => {
    const messageID = props.messageID as string
    const partID = props.partID as string
    if (messageID && partID) {
      const sessionID = (props.sessionID as string) || (draft.parts[messageID] ?? []).find((part) => part.id === partID)?.sessionID || ""
      draft.removedParts[`${messageID}:${partID}`] = { messageID, sessionID }
      draft.parts[messageID] = (draft.parts[messageID] ?? []).filter((item) => item.id !== partID)
    }
  },
  "message.part.delta": (draft, { props }) => {
    const messageID = props.messageID as string
    const partID = props.partID as string
    const field = (props.field as string) ?? "text"
    const delta = props.delta as string
    if (!messageID || !partID || typeof delta !== "string") return
    if (draft.removedMessages[messageID] || draft.removedParts[`${messageID}:${partID}`]) return
    const list = draft.parts[messageID] ?? []
    const index = list.findIndex((item) => item.id === partID)
    if (index >= 0) {
      const current = list[index] as TextPart | ToolPart
      if (field === "text" && "text" in current) {
        list[index] = { ...current, text: `${current.text ?? ""}${delta}` }
      }
    } else {
      list.push({
        id: partID,
        sessionID: (props.sessionID as string) ?? "",
        messageID,
        type: "text",
        text: delta,
      })
    }
    draft.parts[messageID] = list.slice()
  },
  "session.status": (draft, { props, effects }) => {
    const sessionID = props.sessionID as string
    const status = props.status as SessionStatus
    if (sessionID && status) {
      draft.status[sessionID] = status
      if (status.type === "idle") {
        draft.settlingBySession[sessionID] = true
        // Some backends only publish session.status, without the legacy idle event.
        effects.idleSessions.push(sessionID)
      }
    }
  },
  "session.idle": (draft, { props, effects }) => {
    const sessionID = props.sessionID as string
    if (!sessionID) return
    draft.status[sessionID] = { type: "idle" }
    draft.settlingBySession[sessionID] = true
    effects.idleSessions.push(sessionID)
    if (draft.selectedSessionId !== sessionID) draft.attention[sessionID] = true
  },
  "todo.updated": (draft, { props }) => {
    const sessionID = props.sessionID as string
    if (sessionID) draft.todos[sessionID] = (props.todos as Todo[]) ?? []
  },
  "permission.asked": (draft, { props, directory, effects }) => {
    const permission = asPermission(props)
    if (!permission?.id) return
    const reply = autoReplyForMode(draft.permissionMode, permission.permission)
    const path =
      directory ||
      Object.entries(draft.sessionsByProject).find(([, sessions]) =>
        sessions.some((item) => item.id === permission.sessionID),
      )?.[0]
    if (reply && path) {
      effects.autoReplies.push({ id: permission.id, reply, directory: path, permission })
    } else {
      draft.permissions[permission.id] = permission
    }
  },
  "permission.replied": (draft, { props }) => {
    const requestID = (props.requestID as string) ?? (props.id as string)
    if (requestID) delete draft.permissions[requestID]
  },
  "question.asked": (draft, { props }) => {
    const question = asQuestion(props)
    if (question?.id) draft.questions[question.id] = question
  },
  "question.replied": (draft, { props }) => {
    const requestID = (props.requestID as string) ?? (props.id as string)
    if (requestID) delete draft.questions[requestID]
  },
  "question.rejected": (draft, { props }) => {
    const requestID = (props.requestID as string) ?? (props.id as string)
    if (requestID) delete draft.questions[requestID]
  },
  "session.error": (draft, { props }) => {
    const sessionID = props.sessionID as string | undefined
    const error = props.error as (AssistantError & { message?: string }) | string | undefined
    const aborted = isAbortError(error)
    const detail = typeof error === "string" ? undefined : error
    const message = detail?.data?.message || detail?.message || (props.message as string)
    if (sessionID && !aborted) draft.sessionErrors[sessionID] = true
    if (!message || aborted) return
    const friendly = missingDirectoryMessage(String(message))
    if (friendly) {
      draft.error = friendly
      const missingPath = parseMissingDirectory(String(message))
      if (missingPath) {
        for (const project of draft.projects) {
          if (!isLocalProject(project) && samePath(project.path, missingPath)) project.missing = true
        }
      }
      return
    }
    if (sessionID) {
      attachSessionError(
        draft,
        sessionID,
        detail ?? { name: "UnknownError", data: { message: String(message) } },
        formatSessionErrorMessage(String(message)),
      )
    }
  },
}

export function applyClientEvent(draft: AppState, parsed: ParsedEvent): EventEffects {
  const effects: EventEffects = { autoReplies: [], idleSessions: [] }
  if (parsed.event.id) {
    if (draft.seenEventIDs.includes(parsed.event.id)) return effects
    draft.seenEventIDs.push(parsed.event.id)
    if (draft.seenEventIDs.length > 2048) draft.seenEventIDs.splice(0, draft.seenEventIDs.length - 2048)
  }
  const handler = handlers[parsed.event.type]
  if (!handler) return effects
  const props = (parsed.event.properties ?? parsed.event.data ?? {}) as Record<string, unknown>
  const nested = (props.part ?? props.info ?? props.permission ?? props.question ?? props.request) as { sessionID?: string } | undefined
  const sessionID = (props.sessionID as string | undefined) ?? nested?.sessionID
  const ownerID = sessionID ?? (props.info as { id?: string } | undefined)?.id
  if (ownerID && draft.removedSessions[ownerID]) return effects
  if (sessionID) draft.eventRevision[sessionID] = (draft.eventRevision[sessionID] ?? 0) + 1
  handler(draft, {
    props,
    directory: parsed.directory,
    effects,
  })
  return effects
}
