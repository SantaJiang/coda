import type { ComposerAttachment } from "../lib/attachments"
import type { ConfigPatch, ModelRef, ProviderList } from "../lib/models"
import type { PermissionRule } from "../lib/permissions"
import type { ParsedEvent } from "../lib/events"
import type {
  BackendProject,
  MessageWithParts,
  PermissionRequest,
  QuestionRequest,
  Session,
  SessionStatus,
  Todo,
} from "../lib/types"
import type { TerminalClient } from "../lib/terminal-client"

export type PromptInput = {
  text: string
  model: ModelRef
  agent?: string
  variant?: string
  files?: ComposerAttachment[]
  messageID?: string
  partIDs?: string[]
}
export type VcsInfo = { branch?: string | null; default_branch?: string | null }

export interface SessionReader {
  listMessages(directory: string, sessionID: string): Promise<MessageWithParts[]>
  listSessionStatuses(directory: string): Promise<Record<string, SessionStatus>>
  listTodos(directory: string, sessionID: string): Promise<Todo[]>
  listPermissions(directory: string): Promise<PermissionRequest[]>
  listQuestions(directory: string): Promise<QuestionRequest[]>
}
export interface AgentClient extends SessionReader {
  healthcheck(): Promise<boolean>
  listProviders(directory?: string): Promise<ProviderList>
  patchGlobalConfig(body: ConfigPatch): Promise<unknown>
  listProjects(): Promise<BackendProject[]>
  listSessions(directory: string, extra?: Record<string, string>): Promise<Session[]>
  createSession(directory: string, model?: ModelRef, agent?: string, permission?: PermissionRule[]): Promise<Session>
  updateSessionTitle(directory: string, sessionID: string, title: string): Promise<Session>
  deleteSession(directory: string, sessionID: string): Promise<boolean>
  updateSessionPermission(directory: string, sessionID: string, permission: PermissionRule[]): Promise<Session>
  promptAsync(directory: string, sessionID: string, options: PromptInput): Promise<void>
  abortSession(directory: string, sessionID: string): Promise<boolean>
  revertSession(directory: string, sessionID: string, messageID: string): Promise<Session>
  replyPermission(directory: string, requestID: string, reply: "once" | "always" | "reject"): Promise<boolean>
  replyQuestion(directory: string, requestID: string, answers: string[][]): Promise<boolean>
  rejectQuestion(directory: string, requestID: string): Promise<boolean>
  getVcs(directory: string): Promise<VcsInfo>
}

export type EventSubscribe = (
  onEvent: (parsed: ParsedEvent) => void,
  onStatus?: (connected: boolean) => void,
) => () => void

export type AppPorts = {
  client: AgentClient
  subscribe: EventSubscribe
  terminals?: TerminalClient
}
