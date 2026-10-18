import type { TerminalInfo, TerminalLog } from "./terminal-contracts"
import { API_BASE, DEFAULT_AGENT } from "./config"
import type { ComposerAttachment } from "./attachments"
import type { ConfigPatch, ModelRef, ProviderList } from "./models"
import type { PermissionRule } from "./permissions"
import type {
  BackendProject,
  MessageWithParts,
  PermissionRequest,
  QuestionRequest,
  Session,
  SessionStatus,
  Todo,
} from "./types"

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

// WKWebView 在连不上 sidecar 时抛 TypeError: Load failed，Chromium 则是 Failed to fetch。
// 这是启动竞态，不是用户能处理的接口错误。
const UNREACHABLE_MESSAGES = ["load failed", "failed to fetch", "networkerror", "network request failed", "network connection was lost"]

export function isUnreachableError(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : ""
  const text = message.trim().toLowerCase()
  if (!text) return false
  return UNREACHABLE_MESSAGES.some((item) => text.includes(item))
}

const HEALTHCHECK_TIMEOUT_MS = 5_000

function directoryHeaders(directory?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  }
  if (directory) {
    headers["x-coda-directory"] = encodeURIComponent(directory)
  }
  return headers
}

function withDirectory(path: string, directory?: string, extra?: Record<string, string>) {
  const url = new URL(path, API_BASE)
  if (directory) url.searchParams.set("directory", directory)
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      url.searchParams.set(key, value)
    }
  }
  return url.toString()
}

async function parseBody(response: Response) {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function unwrap<T>(body: unknown): T {
  if (body && typeof body === "object" && "data" in body && (body as { data: unknown }).data !== undefined) {
    return (body as { data: T }).data
  }
  return body as T
}

async function request<T>(
  method: string,
  path: string,
  options?: {
    directory?: string
    body?: unknown
    extraQuery?: Record<string, string>
    raw?: boolean
  },
): Promise<T> {
  const headers: Record<string, string> = {
    ...directoryHeaders(options?.directory),
  }
  if (options?.body !== undefined) {
    headers["Content-Type"] = "application/json"
  }

  const response = await fetch(withDirectory(path, options?.directory, options?.extraQuery), {
    method,
    headers,
    body: options?.body === undefined ? undefined : JSON.stringify(options.body),
  })

  if (response.status === 204) return undefined as T

  const body = await parseBody(response)
  if (!response.ok) {
    const message =
      (body && typeof body === "object" && "message" in body && String((body as { message: unknown }).message)) ||
      (typeof body === "string" && body) ||
      `${method} ${path} failed (${response.status})`
    throw new ApiError(message, response.status)
  }
  return options?.raw ? body as T : unwrap<T>(body)
}

export async function healthcheck() {
  const response = await fetch(`${API_BASE}/global/health`, {
    method: "GET",
    signal: AbortSignal.timeout(HEALTHCHECK_TIMEOUT_MS),
  })
  return response.ok
}

export async function fetchHomeDir(): Promise<string | null> {
  try {
    const response = await fetch(`${API_BASE}/global/health`, { method: "GET" })
    if (!response.ok) return null
    const body = await parseBody(response)
    const data = unwrap<{ home?: unknown }>(body)
    return typeof data?.home === "string" && data.home.trim() ? data.home : null
  } catch {
    return null
  }
}

export async function listProjects() {
  return request<BackendProject[]>("GET", "/project", {})
}

export async function listSessions(directory: string, extra?: Record<string, string>) {
  return request<Session[]>("GET", "/session", { directory, extraQuery: extra })
}

export async function listSessionStatuses(directory: string) {
  return request<Record<string, SessionStatus>>("GET", "/session/status", { directory })
}

export async function createSession(
  directory: string,
  model?: ModelRef,
  agent = DEFAULT_AGENT,
  permission?: PermissionRule[],
) {
  return request<Session>("POST", "/session", {
    directory,
    body: {
      agent,
      ...(model ? { model: { id: model.modelID, providerID: model.providerID } } : {}),
      ...(permission ? { permission } : {}),
    },
  })
}

export async function updateSessionTitle(directory: string, sessionID: string, title: string) {
  return request<Session>("PATCH", `/session/${sessionID}`, {
    directory,
    body: { title },
  })
}

export async function updateSessionPermission(directory: string, sessionID: string, permission: PermissionRule[]) {
  return request<Session>("PATCH", `/session/${sessionID}`, {
    directory,
    body: { permission },
  })
}

export async function deleteSession(directory: string, sessionID: string) {
  return request<boolean>("DELETE", `/session/${sessionID}`, { directory })
}

export type VcsInfo = {
  branch?: string | null
  default_branch?: string | null
}

export async function getVcs(directory: string) {
  return request<VcsInfo>("GET", "/vcs", { directory })
}

export async function listMessages(directory: string, sessionID: string) {
  return request<MessageWithParts[]>("GET", `/session/${sessionID}/message`, { directory })
}

export async function promptAsync(
  directory: string,
  sessionID: string,
  options: {
    text: string
    model: ModelRef
    agent?: string
    variant?: string
    files?: ComposerAttachment[]
    messageID?: string
    partIDs?: string[]
  },
) {
  const parts: Array<{ id?: string; type: "text"; text: string } | { id?: string; type: "file"; mime: string; filename?: string; url: string }> =
    []
  if (options.text.trim()) {
    parts.push({ id: options.partIDs?.[parts.length], type: "text", text: options.text })
  }
  for (const file of options.files ?? []) {
    parts.push({
      id: options.partIDs?.[parts.length],
      type: "file",
      mime: file.mime,
      filename: file.filename,
      url: file.url,
    })
  }
  if (!parts.length) return
  return request<void>("POST", `/session/${sessionID}/prompt_async`, {
    directory,
    body: {
      ...(options.messageID ? { messageID: options.messageID } : {}),
      agent: options.agent ?? DEFAULT_AGENT,
      model: {
        providerID: options.model.providerID,
        modelID: options.model.modelID,
      },
      ...(options.variant ? { variant: options.variant } : {}),
      parts,
    },
  })
}

export async function listProviders(directory?: string) {
  return request<ProviderList>("GET", "/provider", { directory })
}

export async function patchGlobalConfig(body: ConfigPatch) {
  return request<unknown>("PATCH", "/global/config", { body })
}

export async function abortSession(directory: string, sessionID: string) {
  return request<boolean>("POST", `/session/${sessionID}/abort`, { directory })
}

export async function revertSession(directory: string, sessionID: string, messageID: string) {
  return request<Session>("POST", `/session/${sessionID}/revert`, {
    directory,
    body: { messageID },
  })
}

export async function listTodos(directory: string, sessionID: string) {
  return request<Todo[]>("GET", `/session/${sessionID}/todo`, { directory })
}

export async function listPermissions(directory: string) {
  return request<PermissionRequest[]>("GET", "/permission", { directory })
}

export async function replyPermission(
  directory: string,
  requestID: string,
  reply: "once" | "always" | "reject",
) {
  return request<boolean>("POST", `/permission/${requestID}/reply`, {
    directory,
    body: { reply },
  })
}

export async function listQuestions(directory: string) {
  return request<QuestionRequest[]>("GET", "/question", { directory })
}

export async function replyQuestion(directory: string, requestID: string, answers: string[][]) {
  return request<boolean>("POST", `/question/${requestID}/reply`, {
    directory,
    body: { answers },
  })
}

export async function rejectQuestion(directory: string, requestID: string) {
  return request<boolean>("POST", `/question/${requestID}/reject`, { directory })
}

export type { TerminalInfo, TerminalLog } from "./terminal-contracts"
export const isTerminalRunning = (info: TerminalInfo) => info.status === "starting" || info.status === "running"
const terminalPath = (sessionID: string, id?: string) => `/session/${encodeURIComponent(sessionID)}/terminals${id ? `/${encodeURIComponent(id)}` : ""}`
export const listTerminals = (directory: string, sessionID: string) => request<{ backendID: string; items: TerminalInfo[] }>("GET", terminalPath(sessionID), { directory })
export const terminalControl = (directory: string, sessionID: string, id: string, action: "cancel" | "hide" | "show" | "resume") => request("POST", `${terminalPath(sessionID, id)}/control`, { directory, body: { action } })
export const terminalLog = (directory: string, sessionID: string, id: string, cursor?: number, limit?: number) => request<TerminalLog>("GET", `${terminalPath(sessionID, id)}/log`, { directory, raw: true, extraQuery: { ...(cursor === undefined ? {} : { cursor: String(cursor) }), ...(limit === undefined ? {} : { limit: String(limit) }) } })
export function terminalStreamURL(directory: string, sessionID: string, id: string, cursor: number) {
  return withDirectory(`${terminalPath(sessionID, id)}/stream`, directory, { cursor: String(cursor) })
}
