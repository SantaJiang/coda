import type { McpConfigEntry, McpServerConfig, McpStatusMap } from "./mcp"
import type { PermissionRule } from "./permissions"
import type { ModelInput } from "./model-input"
import type { ProviderList } from "./models"
import type { AssistantError, AssistantMessage, BackendProject, MessageWithParts, Part, PermissionRequest, QuestionRequest, Session, SessionStatus, Todo, UserMessage } from "./types"
import type { TerminalInfo, TerminalLog } from "./terminal-contracts"

type Rec = Record<string, unknown>

function rec(value: unknown): Rec | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Rec) : undefined
}

function num(value: unknown, fallback = Date.now()) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

export function toPermission(row: Rec): PermissionRequest {
  return {
    id: String(row.id ?? ""),
    sessionID: String(row.sessionID ?? ""),
    permission: String(row.action ?? row.permission ?? ""),
    patterns: Array.isArray(row.resources) ? row.resources.filter((item): item is string => typeof item === "string") : [],
    ...(rec(row.metadata) ? { metadata: rec(row.metadata) } : {}),
    ...(Array.isArray(row.save) ? { always: row.save.filter((item): item is string => typeof item === "string") } : {}),
  }
}

function v2Action(permission: string) {
  if (permission === "bash") return "shell"
  if (permission === "write" || permission === "patch" || permission === "apply_patch") return "edit"
  if (permission === "task") return "subagent"
  return permission
}

export function toV2Rules(rules?: PermissionRule[]) {
  return rules?.map((rule) => ({ action: v2Action(rule.permission), resource: rule.pattern, effect: rule.action }))
}

export function toSession(row: Rec): Session {
  const location = rec(row.location)
  const model = rec(row.model)
  const time = rec(row.time)
  const now = Date.now()
  return {
    id: String(row.id ?? ""),
    projectID: typeof row.projectID === "string" ? row.projectID : undefined,
    directory: typeof location?.directory === "string" ? location.directory : "",
    parentID: typeof row.parentID === "string" ? row.parentID : undefined,
    title: typeof row.title === "string" && row.title.trim() ? row.title : "新会话",
    agent: typeof row.agent === "string" ? row.agent : undefined,
    ...(model && typeof model.id === "string" && typeof model.providerID === "string"
      ? { model: { id: model.id, providerID: model.providerID, variant: typeof model.variant === "string" ? model.variant : undefined } }
      : {}),
    time: {
      created: num(time?.created, now),
      updated: num(time?.updated, now),
      archived: typeof time?.archived === "number" ? time.archived : undefined,
    },
  }
}

export function sessionStatuses(rows: Rec[]): Record<string, SessionStatus> {
  const status: Record<string, SessionStatus> = {}
  for (const row of rows) {
    const time = rec(row.time)
    const busy = typeof time?.busy === "number" ? time.busy : 0
    const idle = typeof time?.idle === "number" ? time.idle : 0
    const id = String(row.id ?? "")
    // Execution.Started bumps time.busy but leaves the previous idle_outcome in place.
    // Trust the stamps: a newer busy means the session has restarted after interrupt/success.
    if (id) status[id] = busy > idle ? { type: "busy" } : { type: "idle" }
  }
  return status
}

export function toProject(row: Rec): BackendProject {
  const time = rec(row.time)
  return {
    id: String(row.id ?? ""),
    worktree: typeof row.canonical === "string" ? row.canonical : typeof row.directory === "string" ? row.directory : "",
    vcs: typeof row.vcs === "string" ? row.vcs : null,
    sandboxes: Array.isArray(row.sandboxes) ? row.sandboxes.filter((item): item is string => typeof item === "string") : [],
    time: { created: num(time?.created, 0), updated: num(time?.updated, 0) },
  }
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join("\n")
  const item = rec(value)
  if (!item) return ""
  if (typeof item.text === "string") return item.text
  if (typeof item.message === "string") return item.message
  if ("content" in item) return textOf(item.content)
  return ""
}

/** Map v2 `{ type, message }` failures without dropping interrupt/abort identity. */
function assistantError(value: unknown): AssistantError | undefined {
  if (!value) return undefined
  if (typeof value === "string") {
    const message = value.trim()
    return message ? { data: { message } } : undefined
  }
  const item = rec(value)
  if (!item) return undefined
  const type = typeof item.type === "string" ? item.type : typeof item.name === "string" ? item.name : ""
  const message = textOf(item).trim() || (type === "aborted" ? "Aborted" : "")
  if (!message && !type) return undefined
  const name = type === "aborted" || type.toLowerCase() === "messageabortederror" || type.toLowerCase() === "aborterror"
    ? "MessageAbortedError"
    : type || undefined
  return { ...(name ? { name } : {}), data: { message } }
}

function partsFromAssistant(sessionID: string, messageID: string, content: unknown[]): Part[] {
  return content.flatMap((item, index): Part[] => {
    const part = rec(item)
    if (!part) return []
    if (part.type === "text") {
      return [{ id: `${messageID}:text:${index}`, sessionID, messageID, type: "text", text: typeof part.text === "string" ? part.text : "" }]
    }
    if (part.type === "reasoning") {
      const time = rec(part.time)
      const start = typeof time?.created === "number" ? time.created : 0
      const end = typeof time?.completed === "number" ? time.completed : start
      return [{ id: `${messageID}:reasoning:${index}`, sessionID, messageID, type: "reasoning", text: typeof part.text === "string" ? part.text : "", time: { start, end } }]
    }
    if (part.type !== "tool") return []
    const state = rec(part.state)
    const status = state?.status
    const input = rec(state?.input)
    const base = { id: String(part.id ?? index), sessionID, messageID, type: "tool" as const, callID: String(part.id ?? index), tool: typeof part.name === "string" ? part.name : "" }
    if (status === "completed") return [{ ...base, state: { status: "completed", input, output: textOf(state?.content), metadata: rec(state?.metadata) } }]
    if (status === "error") return [{ ...base, state: { status: "error", input, error: textOf(state?.error) || "工具失败", metadata: rec(state?.metadata) } }]
    if (status === "running") {
      const time = rec(part.time)
      const start = typeof time?.ran === "number" ? time.ran : typeof time?.created === "number" ? time.created : undefined
      const timeout = typeof input?.timeout === "number" ? input.timeout : undefined
      const metadata = {
        ...(rec(state?.metadata) ?? {}),
        ...(start !== undefined ? { terminalStartedAt: start } : {}),
        ...(start !== undefined && timeout && timeout > 0 ? { nextCheckAt: start + timeout } : {}),
      }
      return [{
        ...base,
        state: {
          status: "running",
          input,
          metadata,
          ...(start !== undefined ? { time: { start } } : {}),
        },
      }]
    }
    return [{ ...base, state: { status: "pending", input: typeof state?.input === "string" ? undefined : input, raw: typeof state?.input === "string" ? state.input : undefined } }]
  })
}

function fileParts(sessionID: string, messageID: string, files: unknown): Part[] {
  if (!Array.isArray(files)) return []
  return files.flatMap((item, index) => {
    const file = rec(item)
    const url = typeof file?.uri === "string" ? file.uri : typeof file?.url === "string" ? file.url : ""
    if (!url) return []
    return [{
      id: `${messageID}:file:${index}`,
      sessionID,
      messageID,
      type: "file" as const,
      url,
      ...(typeof file?.name === "string" ? { filename: file.name } : typeof file?.filename === "string" ? { filename: file.filename } : {}),
      ...(typeof file?.mime === "string" ? { mime: file.mime } : {}),
    }]
  })
}

export function toTranscript(sessionID: string, rows: Rec[]): MessageWithParts[] {
  const messages: MessageWithParts[] = []
  for (const row of rows) {
    const id = String(row.id ?? "")
    const created = num(rec(row.time)?.created)
    if (row.type === "user" || row.type === "synthetic" || row.type === "system") {
      const info: UserMessage = { id, sessionID, role: "user", time: { created } }
      const parts: Part[] = []
      // Directory guides and other model-only injections must not become a new user turn.
      const injected = row.type === "synthetic" || row.type === "system"
      if (typeof row.text === "string" && row.text) {
        parts.push({ id: `${id}:text`, sessionID, messageID: id, type: "text", text: row.text, ...(injected ? { synthetic: true } : {}) })
      }
      parts.push(...fileParts(sessionID, id, row.files))
      messages.push({ info, parts })
      continue
    }
    if (row.type === "shell") {
      const output = typeof row.output === "string" ? row.output : textOf(row.output)
      const command = typeof row.command === "string" ? row.command : ""
      const failed = row.status === "killed" || row.status === "timeout" || (typeof row.exit === "number" && row.exit !== 0)
      const completedAt = rec(row.time)?.completed
      messages.push({
        info: { id, sessionID, role: "assistant", time: { created, ...(typeof completedAt === "number" ? { completed: completedAt } : {}) } },
        parts: [{
          id: String(row.shellID ?? id),
          sessionID,
          messageID: id,
          type: "tool",
          callID: String(row.shellID ?? id),
          tool: "shell",
          state: row.status === "running"
            ? { status: "running", input: { command } }
            : failed
              ? { status: "error", input: { command }, error: output || "命令失败" }
              : { status: "completed", input: { command }, output },
        }],
      })
      continue
    }
    if (row.type !== "assistant") continue
    const time = rec(row.time)
    const model = rec(row.model)
    const info: AssistantMessage = {
      id,
      sessionID,
      role: "assistant",
      time: { created, completed: typeof time?.completed === "number" ? time.completed : undefined },
      agent: typeof row.agent === "string" ? row.agent : undefined,
      providerID: typeof model?.providerID === "string" ? model.providerID : undefined,
      modelID: typeof model?.id === "string" ? model.id : undefined,
      finish: typeof row.finish === "string" ? row.finish : undefined,
      error: assistantError(row.error),
    }
    messages.push({ info, parts: partsFromAssistant(sessionID, id, Array.isArray(row.content) ? row.content : []) })
  }
  return messages
}

export function toProviderList(providers: Rec[], models: Rec[]): ProviderList {
  const all = new Map<string, ProviderList["all"][number]>()
  for (const provider of providers) {
    const id = String(provider.id ?? "")
    if (id) all.set(id, { id, name: typeof provider.name === "string" ? provider.name : id, models: {} })
  }
  for (const model of models) {
    const providerID = String(model.providerID ?? "")
    const modelID = String(model.modelID ?? model.id ?? "")
    if (!providerID || !modelID || model.enabled === false) continue
    const bucket = all.get(providerID) ?? { id: providerID, name: providerID, models: {} }
    const capabilities = rec(model.capabilities)
    const input = Array.isArray(capabilities?.input) ? capabilities.input.filter((item): item is string => typeof item === "string") : []
    const media: ModelInput = {}
    for (const kind of input) if (kind === "text" || kind === "image" || kind === "pdf" || kind === "audio" || kind === "video") media[kind] = true
    const variants = Array.isArray(model.variants) ? model.variants : []
    bucket.models[modelID] = {
      id: modelID,
      name: typeof model.name === "string" ? model.name : modelID,
      variants: Object.fromEntries(variants.flatMap((item) => {
        const variant = rec(item)
        return typeof variant?.id === "string" ? [[variant.id, {}]] : []
      })),
      ...(Object.keys(media).length ? { capabilities: { input: media } } : {}),
      ...(typeof model.package === "string" ? { api: { npm: model.package } } : {}),
    }
    all.set(providerID, bucket)
  }
  const connected = providers.flatMap((provider) => (provider.activation === "disabled" ? [] : typeof provider.id === "string" ? [provider.id] : []))
  return { all: [...all.values()], default: {}, connected }
}

function uiServer(config: Rec): McpServerConfig | undefined {
  const enabled = config.disabled === true ? false : undefined
  if (config.type === "remote" && typeof config.url === "string") {
    return { type: "remote", url: config.url, ...(rec(config.headers) ? { headers: config.headers as Record<string, string> } : {}), ...(enabled === false ? { enabled } : {}) }
  }
  if (config.type === "local" && Array.isArray(config.command)) {
    return {
      type: "local",
      command: config.command.filter((item): item is string => typeof item === "string"),
      ...(rec(config.environment) ? { environment: config.environment as Record<string, string> } : {}),
      ...(enabled === false ? { enabled } : {}),
    }
  }
  return undefined
}

export function mcpConfigFromEntries(entries: unknown[]): Record<string, McpConfigEntry> {
  const result: Record<string, McpConfigEntry> = {}
  for (const entry of entries) {
    const row = rec(entry)
    if (row?.type !== "document") continue
    const servers = rec(rec(rec(row.info)?.mcp)?.servers)
    if (!servers) continue
    for (const [name, value] of Object.entries(servers)) {
      const config = rec(value)
      const server = config ? uiServer(config) : undefined
      if (server) result[name] = server
    }
  }
  return result
}

export function mcpStatusFromServers(servers: Rec[]): McpStatusMap {
  const result: McpStatusMap = {}
  for (const server of servers) {
    const name = typeof server.name === "string" ? server.name : ""
    const status = rec(server.status)
    if (!name || !status) continue
    const kind = status.status
    if (kind === "connected" || kind === "disabled") result[name] = { status: kind }
    else if (kind === "needs_auth") result[name] = { status: "needs_auth" }
    else result[name] = { status: "failed", error: typeof status.error === "string" ? status.error : kind === "pending" ? "正在连接" : "连接失败" }
  }
  return result
}

const TODO_STATUS = new Set(["pending", "in_progress", "completed", "cancelled"])

export function todosFromInput(value: unknown): Todo[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.flatMap((item) => {
    const row = rec(item)
    if (!row || typeof row.content !== "string" || !row.content) return []
    return [{
      content: row.content,
      status: typeof row.status === "string" && TODO_STATUS.has(row.status) ? row.status : "pending",
      ...(typeof row.priority === "string" ? { priority: row.priority } : {}),
    }]
  })
}

/** The visible plan is the latest completed todowrite in the session transcript. */
export function todosFromMessages(rows: Rec[]): Todo[] {
  let latest: Todo[] | undefined
  for (const row of rows) {
    if (row.type !== "assistant" || !Array.isArray(row.content)) continue
    for (const item of row.content) {
      const part = rec(item)
      const state = rec(part?.state)
      const input = rec(state?.input)
      if (part?.type !== "tool" || part.name !== "todowrite" || state?.status !== "completed") continue
      const todos = todosFromInput(input?.todos)
      if (todos) latest = todos
    }
  }
  return latest ?? []
}

export function formToQuestion(row: Rec): QuestionRequest | null {
  const metadata = rec(row.metadata)
  const fields = Array.isArray(row.fields) ? row.fields : []
  const questions = fields.flatMap((item) => {
    const field = rec(item)
    if (!field || (field.type !== "string" && field.type !== "multiselect")) return []
    const options = Array.isArray(field.options)
      ? field.options.flatMap((option) => {
          const value = rec(option)
          return typeof value?.label === "string"
            ? [{ label: value.label, ...(typeof value.description === "string" ? { description: value.description } : {}) }]
            : []
        })
      : []
    if (!options.length && metadata?.kind !== "question") return []
    return [{
      question: typeof field.description === "string" && field.description ? field.description : typeof field.title === "string" ? field.title : "",
      ...(typeof field.title === "string" ? { header: field.title } : {}),
      options,
      ...(field.type === "multiselect" ? { multiple: true } : {}),
      ...(field.custom === true ? { custom: true } : {}),
    }]
  })
  const id = typeof row.id === "string" ? row.id : ""
  const sessionID = typeof row.sessionID === "string" ? row.sessionID : ""
  if (!id || !sessionID || sessionID === "global" || !questions.length) return null
  if (metadata?.kind !== "question" && !questions.some((item) => item.options.length > 0)) return null
  return { id, sessionID, questions }
}

export function shellStatus(status: unknown, exit: unknown): TerminalInfo["status"] {
  if (status === "running") return "running"
  if (status === "killed") return "cancelled"
  if (status === "timeout") return "failed"
  if (typeof exit === "number" && exit !== 0) return "failed"
  return "completed"
}

export function shellToTerminal(row: Rec, sessionID: string, hidden = false): TerminalInfo | null {
  const id = typeof row.id === "string" ? row.id : ""
  const metadata = rec(row.metadata)
  const owner = typeof metadata?.sessionID === "string" ? metadata.sessionID : ""
  if (!id || owner !== sessionID) return null
  const time = rec(row.time)
  const startedAt = num(time?.started, 0)
  const status = shellStatus(row.status, row.exit)
  const endedAt = status === "running" ? undefined : num(time?.completed, startedAt)
  const timeout = typeof row.timeout === "number" ? row.timeout : typeof metadata?.timeout === "number" ? metadata.timeout : undefined
  const nextCheckAt = status === "running" && startedAt && timeout && timeout > 0 ? startedAt + timeout : undefined
  return {
    id,
    sessionID,
    rootSessionID: sessionID,
    command: typeof row.command === "string" ? row.command : "",
    cwd: typeof row.cwd === "string" ? row.cwd : "",
    startedAt,
    lastOutputAt: status === "running" ? Date.now() : endedAt ?? startedAt,
    ...(endedAt !== undefined ? { endedAt } : {}),
    ...(typeof row.exit === "number" ? { exitCode: row.exit } : {}),
    ...(nextCheckAt !== undefined ? { nextCheckAt } : {}),
    status,
    ...(hidden ? { hidden: true } : {}),
    cursor: 1,
    baseCursor: 0,
  }
}

export function utf8Base64(text: string) {
  const bytes = new TextEncoder().encode(text)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function shellOutputToLog(page: Rec, start: number, status: TerminalInfo["status"]): TerminalLog {
  const cursor = num(page.cursor, start)
  const endCursor = num(page.size, cursor)
  const output = typeof page.output === "string" ? page.output : ""
  return {
    data: utf8Base64(output),
    start,
    cursor,
    baseCursor: 0,
    endCursor,
    truncated: false,
    status,
    ended: status !== "running" && status !== "starting" && cursor >= endCursor,
  }
}
