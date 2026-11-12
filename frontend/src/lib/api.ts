import type { McpServerConfig } from "./mcp"
import type { TerminalInfo } from "./terminal-contracts"
import { API_BASE, DEFAULT_AGENT } from "./config"
import type { ComposerAttachment } from "./attachments"
import type { ConfigPatch, ModelRef } from "./models"
import type { PermissionRule } from "./permissions"
import { formToQuestion, mcpConfigFromEntries, mcpStatusFromServers, sessionStatuses, shellOutputToLog, shellStatus, shellToTerminal, todosFromMessages, toPermission, toProject, toProviderList, toSession, toTranscript, toV2Rules } from "./v2-map"
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

function withDirectory(path: string, directory?: string, extra?: Record<string, string>, scope: "location" | "session" | "none" = "location") {
  const url = new URL(path, API_BASE)
  if (directory && scope === "session") url.searchParams.set("directory", directory)
  if (directory && scope === "location") url.searchParams.set("location[directory]", directory)
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
    scope?: "location" | "session" | "none"
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

function pageOf(body: unknown) {
  const row = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  const items = Array.isArray(row.data) ? (row.data as Record<string, unknown>[]) : []
  const cursor = row.cursor && typeof row.cursor === "object" ? (row.cursor as Record<string, unknown>).next : undefined
  return { items, next: typeof cursor === "string" && cursor ? cursor : undefined }
}

async function collectPages(
  path: string,
  options: { directory?: string; scope?: "location" | "session" | "none"; extraQuery?: Record<string, string> },
  pages = 40,
) {
  const items: Record<string, unknown>[] = []
  let cursor: string | undefined
  for (let index = 0; index < pages; index++) {
    let body: unknown
    try {
      body = await request<unknown>("GET", path, {
        ...options,
        raw: true,
        // The cursor already carries the first page's order and filter. Sending them again is rejected.
        extraQuery: cursor ? { cursor } : options.extraQuery,
      })
    } catch (error) {
      if (index === 0) throw error
      break
    }
    const page = pageOf(body)
    items.push(...page.items)
    if (!page.next || page.next === cursor) break
    cursor = page.next
  }
  return items
}

async function sessionRows(directory: string, extra?: Record<string, string>) {
  return collectPages("/api/session", { directory, scope: "session", extraQuery: { limit: "100", order: "desc", ...extra } })
}

async function readSession(sessionID: string) {
  return toSession(await request<Record<string, unknown>>("GET", sessionPath(sessionID), { scope: "none" }))
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
    scope: "none",
    body: {
      agent,
      location: { directory },
      ...(model ? { model: { id: model.modelID, providerID: model.providerID } } : {}),
      ...(permission ? { permissions: toV2Rules(permission) } : {}),
    },
  })
  return toSession(row)
}

export async function updateSessionTitle(_directory: string, sessionID: string, title: string) {
  await request("PATCH", sessionPath(sessionID), { scope: "none", body: { title } })
  const session = await readSession(sessionID)
  return { ...session, title, directory: session.directory || _directory }
}

export async function updateSessionPermission(_directory: string, sessionID: string, permission: PermissionRule[]) {
  await request("PATCH", sessionPath(sessionID), { scope: "none", body: { permissions: toV2Rules(permission) } })
  const session = await readSession(sessionID)
  return { ...session, directory: session.directory || _directory }
}

export async function deleteSession(_directory: string, sessionID: string) {
  await request("DELETE", sessionPath(sessionID), { scope: "none" })
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

async function messageRows(directory: string, sessionID: string) {
  // Newest page first, so a very long session keeps the latest turns when paging stops.
  const rows = await collectPages(sessionPath(sessionID, "/message"), {
    directory,
    scope: "none",
    extraQuery: { limit: "200", order: "desc" },
  })
  return rows.reverse()
}

export async function listMessages(directory: string, sessionID: string) {
  return toTranscript(sessionID, await messageRows(directory, sessionID))
}

export async function promptAsync(
  _directory: string,
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
  const session = { scope: "none" as const }
  await request("POST", sessionPath(sessionID, "/model"), {
    ...session,
    body: { model: { id: options.model.modelID, providerID: options.model.providerID, ...(options.variant ? { variant: options.variant } : {}) } },
  })
  if (options.agent) await request("POST", sessionPath(sessionID, "/agent"), { ...session, body: { agent: options.agent } })
  await request("POST", sessionPath(sessionID, "/prompt"), {
    ...session,
    body: {
      text,
      ...(options.messageID?.startsWith("msg_") ? { id: options.messageID } : {}),
      ...(files.length ? { files } : {}),
    },
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

export async function abortSession(_directory: string, sessionID: string) {
  const body = await request<{ interrupted?: boolean }>("POST", sessionPath(sessionID, "/interrupt"), { scope: "none" })
  return body?.interrupted !== false
}

export async function revertSession(directory: string, sessionID: string, messageID: string) {
  await request("POST", sessionPath(sessionID, "/revert/stage"), { scope: "none", body: { messageID } })
  await request("POST", sessionPath(sessionID, "/revert/commit"), { scope: "none" })
  const session = await readSession(sessionID)
  return { ...session, directory: session.directory || directory }
}

export async function listTodos(directory: string, sessionID: string) {
  return todosFromMessages(await messageRows(directory, sessionID))
}

export async function listPermissions(directory: string) {
  const rows = await request<Record<string, unknown>[]>("GET", "/api/permission/request", { directory })
  return (Array.isArray(rows) ? rows : []).map(toPermission)
}

export async function replyPermission(
  _directory: string,
  requestID: string,
  reply: "once" | "always" | "reject",
  sessionID?: string,
) {
  if (!sessionID) return false
  await request("POST", sessionPath(sessionID, `/permission/${encodeURIComponent(requestID)}/reply`), {
    scope: "none",
    body: { decision: reply },
  })
  return true
}

export async function listQuestions(directory: string) {
  const forms = await request<Record<string, unknown>[]>("GET", "/api/form", { directory })
  return (Array.isArray(forms) ? forms : []).flatMap((form) => {
    const question = formToQuestion(form)
    return question ? [question] : []
  })
}

export async function replyQuestion(_directory: string, requestID: string, answers: string[][], sessionID?: string) {
  if (!sessionID) return false
  const detail = await request<Record<string, unknown>>("GET", sessionPath(sessionID, `/form/${encodeURIComponent(requestID)}`), { scope: "none" })
  const answer: Record<string, string | string[]> = {}
  // Use the same field mapping as the dock so indexes line up, and submit each
  // option's `value` instead of its display `label` (they often differ, e.g. the
  // web search provider form).
  for (const [index, question] of (formToQuestion(detail)?.questions ?? []).entries()) {
    if (!question.key) continue
    const values = (answers[index] ?? []).map(
      (label) => question.options.find((option) => option.label === label)?.value ?? label,
    )
    answer[question.key] = question.multiple ? values : (values[0] ?? "")
  }
  await request("POST", sessionPath(sessionID, `/form/${encodeURIComponent(requestID)}/reply`), { scope: "none", body: { answer } })
  return true
}

export async function rejectQuestion(_directory: string, requestID: string, sessionID?: string) {
  if (!sessionID) return false
  await request("DELETE", sessionPath(sessionID, `/form/${encodeURIComponent(requestID)}`), { scope: "none" })
  return true
}

export type { TerminalInfo, TerminalLog } from "./terminal-contracts"
export const isTerminalRunning = (info: TerminalInfo) => info.status === "starting" || info.status === "running"

const seenShells = new Map<string, Set<string>>()
const hiddenKey = (sessionID: string, id: string) => `coda.terminalHidden:${sessionID}:${id}`
const rememberedKey = (sessionID: string) => `coda.shells:${sessionID}`

function rememberedShells(sessionID: string) {
  const ids = seenShells.get(sessionID) ?? new Set<string>()
  seenShells.set(sessionID, ids)
  try {
    const saved = JSON.parse(localStorage.getItem(rememberedKey(sessionID)) || "[]")
    if (Array.isArray(saved)) for (const id of saved) if (typeof id === "string") ids.add(id)
  } catch {
    // Ignore a corrupt local list and keep what this page has already seen.
  }
  return ids
}

function storeShells(sessionID: string, ids: Set<string>) {
  try { localStorage.setItem(rememberedKey(sessionID), JSON.stringify([...ids])) } catch { /* private mode */ }
}

function shellHidden(sessionID: string, id: string) {
  try { return localStorage.getItem(hiddenKey(sessionID, id)) === "1" } catch { return false }
}

async function readShell(directory: string, id: string) {
  return request<Record<string, unknown>>("GET", `/api/shell/${encodeURIComponent(id)}`, { directory })
}

export async function listTerminals(directory: string, sessionID: string) {
  const running = await request<Record<string, unknown>[]>("GET", "/api/shell", { directory })
  const ids = rememberedShells(sessionID)
  const rows = new Map<string, Record<string, unknown>>()
  for (const row of Array.isArray(running) ? running : []) {
    const info = shellToTerminal(row, sessionID)
    if (info && isTerminalRunning(info)) {
      rows.set(String(row.id), row)
      ids.add(String(row.id))
    }
  }
  await Promise.all([...ids].filter((id) => !rows.has(id)).map(async (id) => {
    try {
      const row = await readShell(directory, id)
      const info = shellToTerminal(row, sessionID)
      // Completed shells have already closed; forget them on the next refresh.
      if (info && isTerminalRunning(info)) rows.set(id, row)
      else ids.delete(id)
    } catch {
      ids.delete(id)
    }
  }))
  storeShells(sessionID, ids)
  const items = [...rows.values()].flatMap((row) => {
    const info = shellToTerminal(row, sessionID, shellHidden(sessionID, String(row.id)))
    return info ? [info] : []
  })
  return { backendID: "v2", items }
}

export async function terminalControl(directory: string, sessionID: string, id: string, action: "cancel" | "hide" | "show" | "resume") {
  if (action === "hide" || action === "show") {
    try {
      if (action === "hide") localStorage.setItem(hiddenKey(sessionID, id), "1")
      else localStorage.removeItem(hiddenKey(sessionID, id))
    } catch { /* the next list still returns the shell */ }
    return true
  }
  if (action === "resume") return true
  await request("DELETE", `/api/shell/${encodeURIComponent(id)}`, { directory }).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) return
    throw error
  })
  return true
}

export async function terminalLog(directory: string, _sessionID: string, id: string, cursor = 0, limit?: number) {
  const [info, page] = await Promise.all([
    readShell(directory, id).catch(() => undefined),
    request<Record<string, unknown>>("GET", `/api/shell/${encodeURIComponent(id)}/output`, {
      directory,
      extraQuery: { cursor: String(cursor), ...(limit === undefined ? {} : { limit: String(limit) }) },
    }),
  ])
  const status = info ? shellStatus(info.status, info.exit) : "running"
  return shellOutputToLog(page, cursor, status)
}

export function terminalStreamURL(_directory: string, _sessionID: string, _id: string, _cursor: number) {
  return ""
}
