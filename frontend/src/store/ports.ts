import type * as api from "../lib/api"
import type { ParsedEvent } from "../lib/events"

export type AgentClient = Pick<
  typeof api,
  | "healthcheck"
  | "listProviders"
  | "patchGlobalConfig"
  | "listProjects"
  | "listSessions"
  | "listSessionStatuses"
  | "listMessages"
  | "listTodos"
  | "listPermissions"
  | "listQuestions"
  | "createSession"
  | "updateSessionTitle"
  | "deleteSession"
  | "updateSessionPermission"
  | "promptAsync"
  | "abortSession"
  | "revertSession"
  | "replyPermission"
  | "replyQuestion"
  | "rejectQuestion"
  | "getVcs"
>

export type EventSubscribe = (
  onEvent: (parsed: ParsedEvent) => void,
  onStatus?: (connected: boolean) => void,
) => () => void

export type AppPorts = {
  client: AgentClient
  subscribe: EventSubscribe
}
