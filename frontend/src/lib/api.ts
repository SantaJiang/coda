import { API_BASE, DEFAULT_AGENT } from "./config"
import type { ComposerAttachment } from "./attachments"
import type { ConfigPatch, ModelRef, ProviderList } from "./models"
import type { PermissionRule } from "./permissions"
import type {
  MessageWithParts,
  PermissionRequest,
  QuestionRequest,
  Session,
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
    expectJson?: boolean
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
  return unwrap<T>(body)
}

export async function healthcheck() {
  const response = await fetch(`${API_BASE}/global/health`, { method: "GET" })
  return response.ok
}

export async function listSessions(directory: string) {
  return request<Session[]>("GET", "/session", { directory })
}

export async function createSession(
  directory: string,
  title?: string,
  model?: ModelRef,
  agent = DEFAULT_AGENT,
  permission?: PermissionRule[],
) {
  return request<Session>("POST", "/session", {
    directory,
    body: {
      ...(title !== undefined ? { title } : {}),
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
  return request<VcsInfo>("GET", "/instance/vcs", { directory })
}

export async function getSession(directory: string, sessionID: string) {
  return request<Session>("GET", `/session/${sessionID}`, { directory })
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
  },
) {
  const parts: Array<{ type: "text"; text: string } | { type: "file"; mime: string; filename?: string; url: string }> =
    []
  if (options.text.trim()) {
    parts.push({ type: "text", text: options.text })
  }
  for (const file of options.files ?? []) {
    parts.push({
      type: "file",
      mime: file.mime,
      filename: file.filename,
      url: file.url,
    })
  }
  return request<void>("POST", `/session/${sessionID}/prompt_async`, {
    directory,
    body: {
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
