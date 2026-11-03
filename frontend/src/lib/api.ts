import type { McpServerConfig } from "./mcp"
import type { TerminalInfo, TerminalLog } from "./terminal-contracts"
import { API_BASE, DEFAULT_AGENT } from "./config"
import type { ComposerAttachment } from "./attachments"
import type { ConfigPatch, ModelRef } from "./models"
import type { PermissionRule } from "./permissions"
import { mcpConfigFromEntries, mcpStatusFromServers, sessionStatuses, toPermission, toProject, toProviderList, toSession, toTranscript, toV2Rules } from "./v2-map"
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
  if (directory) headers["x-coda-directory"] = encodeURIComponent(directory)
  return headers
}

function withDirectory(path: string, directory?: string, extra?: Record<string, string>, scope: "location" | "session" = "location") {
  const url = new URL(path, API_BASE)
  if (directory) {
    if (scope === "session") url.searchParams.set("directory", directory)
    else url.searchParams.set("location[directory]", directory)
  }
  if (extra) {
    for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value)
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
    scope?: "location" | "session"
  },
): Promise<T> {
  const headers: Record<string, string> = {
    ...directoryHeaders(options?.directory),
  }
  if (options?.body !== undefined) {
    headers["Content-Type"] = "application/json"
  }

  const response = await fetch(withDirectory(path, options?.directory, options?.extraQuery, options?.scope), {
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
  const response = await fetch(`${API_BASE}/api/info`, {
    method: "GET",
    signal: AbortSignal.timeout(HEALTHCHECK_TIMEOUT_MS),
  })
  return response.ok
}

export async function fetchHomeDir(): Promise<string | null> {
  return null
}

async function sessionRows(directory: string, extra?: Record<string, string>) {
  const rows = await request<Record<string, unknown>[]>("GET", "/api/session", {
    directory,
    scope: "session",
    extraQuery: { limit: "100", order: "desc", ...extra },
  })
  return Array.isArray(rows) ? rows : []
}

export async function listProjects() {
  const rows = await request<Record<string, unknown>[]>("GET", "/api/project", {})
  return (Array.isArray(rows) ? rows : []).map(toProject)
}

export async function listSessions(directory: string, extra?: Record<string, string>) {
  return (await sessionRows(directory, extra)).map(toSession)
}

export async function listSessionStatuses(directory: string) {
  return sessionStatuses(await sessionRows(directory))
}

const sessionPath = (sessionID: string, suffix = "") => `/api/session/${encodeURIComponent(sessionID)}${suffix}`

export async function createSession(
  directory: string,
  model?: ModelRef,
  agent = DEFAULT_AGENT,
  permission?: PermissionRule[],
) {
  const row = await request<Record<string, unknown>>("POST", "/api/session", {
    directory,
    body: {
      agent,
      location: { directory },
      ...(model ? { model: { id: model.modelID, providerID: model.providerID } } : {}),
      ...(permission ? { permissions: toV2Rules(permission) } : {}),
    },
  })
  return toSession(row)
}

export async function updateSessionTitle(directory: string, sessionID: string, title: string) {
  await request("PATCH", sessionPath(sessionID), { directory, body: { title } })
  return { ...(await listSessions(directory)).find((item) => item.id === sessionID), id: sessionID, directory, title, time: { created: Date.now(), updated: Date.now() } }
}

export async function updateSessionPermission(directory: string, sessionID: string, permission: PermissionRule[]) {
  await request("PATCH", sessionPath(sessionID), { directory, body: { permissions: toV2Rules(permission) } })
  return { id: sessionID, directory, title: "", time: { created: Date.now(), updated: Date.now() } }
}

export async function deleteSession(directory: string, sessionID: string) {
  await request("DELETE", sessionPath(sessionID), { directory })
  return true
}

export type VcsInfo = {
  branch?: string | null
  default_branch?: string | null
}

export async function getVcs(directory: string) {
  const info = await request<{ branch?: { current?: string | null; default?: string | null } }>("GET", "/api/vcs", { directory })
  return { branch: info?.branch?.current ?? null, default_branch: info?.branch?.default ?? null }
}

export async function listMessages(directory: string, sessionID: string) {
  const rows = await request<Record<string, unknown>[]>("GET", sessionPath(sessionID, "/message"), {
    directory,
    extraQuery: { limit: "200", order: "asc" },
  })
  return toTranscript(sessionID, Array.isArray(rows) ? rows : [])
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
  const text = options.text.trim()
  const files = (options.files ?? []).map((file) => ({ uri: file.url, ...(file.filename ? { name: file.filename } : {}) }))
  if (!text && !files.length) return
  await request("POST", sessionPath(sessionID, "/model"), {
    directory,
    body: { model: { id: options.model.modelID, providerID: options.model.providerID, ...(options.variant ? { variant: options.variant } : {}) } },
  })
  if (options.agent) await request("POST", sessionPath(sessionID, "/agent"), { directory, body: { agent: options.agent } })
  await request("POST", sessionPath(sessionID, "/prompt"), {
    directory,
    body: { text, ...(files.length ? { files } : {}) },
  })
}

export async function listProviders(directory?: string) {
  const [providers, models] = await Promise.all([
    request<Record<string, unknown>[]>("GET", "/api/provider", { directory }),
    request<Record<string, unknown>[]>("GET", "/api/model", { directory }),
  ])
  return toProviderList(Array.isArray(providers) ? providers : [], Array.isArray(models) ? models : [])
}

export async function patchGlobalConfig(body: ConfigPatch) {
  return request<unknown>("PATCH", "/api/experimental/config", { body: { provider: body.provider } })
}

export async function getGlobalConfig() {
  const entries = await request<unknown[]>("GET", "/api/config", {})
  return { mcp: mcpConfigFromEntries(Array.isArray(entries) ? entries : []) }
}

export async function listMcp(directory: string) {
  const servers = await request<Record<string, unknown>[]>("GET", "/api/mcp", { directory })
  return mcpStatusFromServers(Array.isArray(servers) ? servers : [])
}

export async function saveMcpServer(name: string, server: McpServerConfig) {
  return request<unknown>("PATCH", "/api/experimental/config", { body: { mcp: { [name]: server } } })
}

const mcpServerPath = (name: string, suffix = "") => `/api/experimental/mcp/${encodeURIComponent(name)}${suffix}`

async function setMcpEnabled(name: string, enabled: boolean) {
  await request("PATCH", "/api/experimental/config", { body: { mcp: { [name]: { enabled } } } })
}

export async function connectMcp(directory: string, name: string) {
  await setMcpEnabled(name, true)
  await request("POST", mcpServerPath(name, "/connect"), { directory })
  return true
}

export async function disconnectMcp(directory: string, name: string) {
  await setMcpEnabled(name, false)
  await request("POST", mcpServerPath(name, "/disconnect"), { directory })
  return true
}

export async function removeMcp(directory: string, name: string) {
  await request("PATCH", "/api/experimental/config", { body: { mcpRemove: [name] } })
  await request("DELETE", mcpServerPath(name), { directory }).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) return
    throw error
  })
  return true
}

export async function authenticateMcp(directory: string, name: string) {
  return connectMcp(directory, name)
}

export async function abortSession(directory: string, sessionID: string) {
  const body = await request<{ interrupted?: boolean }>("POST", sessionPath(sessionID, "/interrupt"), { directory })
  return body?.interrupted !== false
}

export async function revertSession(directory: string, sessionID: string, messageID: string) {
  await request("POST", sessionPath(sessionID, "/revert/stage"), { directory, body: { messageID } })
  await request("POST", sessionPath(sessionID, "/revert/commit"), { directory })
  return (await listSessions(directory)).find((item) => item.id === sessionID) ?? { id: sessionID, directory, title: "", time: { created: Date.now(), updated: Date.now() } }
}

export async function listTodos(_directory: string, _sessionID: string) {
  return []
}

export async function listPermissions(directory: string) {
  const sessions = await listSessions(directory)
  const lists = await Promise.all(
    sessions.map(async (session) => {
      const rows = await request<Record<string, unknown>[]>("GET", sessionPath(session.id, "/permission"), { directory })
      return (Array.isArray(rows) ? rows : []).map(toPermission)
    }),
  )
  return lists.flat()
}

export async function replyPermission(
  directory: string,
  requestID: string,
  reply: "once" | "always" | "reject",
  sessionID?: string,
) {
  if (!sessionID) return false
  await request("POST", sessionPath(sessionID, `/permission/${encodeURIComponent(requestID)}/reply`), {
    directory,
    body: { decision: reply },
  })
  return true
}

export async function listQuestions(_directory: string) {
  return []
}

export async function replyQuestion(_directory: string, _requestID: string, _answers: string[][]) {
  return false
}

export async function rejectQuestion(_directory: string, _requestID: string) {
  return false
}

export type { TerminalInfo, TerminalLog } from "./terminal-contracts"
export const isTerminalRunning = (info: TerminalInfo) => info.status === "starting" || info.status === "running"
export const listTerminals = (_directory: string, _sessionID: string) => Promise.resolve({ backendID: "v2", items: [] as TerminalInfo[] })
export const terminalControl = async (_directory: string, _sessionID: string, _id: string, _action: "cancel" | "hide" | "show" | "resume") => false
export const terminalLog = (_directory: string, _sessionID: string, _id: string, cursor = 0, _limit?: number): Promise<TerminalLog> => Promise.resolve({ data: "", start: cursor, cursor, baseCursor: 0, endCursor: cursor, truncated: false, status: "completed", ended: true })
export function terminalStreamURL(_directory: string, _sessionID: string, _id: string, _cursor: number) {
  return ""
}
