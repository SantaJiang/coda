import type { McpConfigEntry, McpServerConfig, McpStatusMap } from "./mcp"
import type { PermissionRule } from "./permissions"
import type { ModelInput } from "./model-input"
import type { ProviderList } from "./models"
import type { AssistantMessage, BackendProject, MessageWithParts, Part, PermissionRequest, Session, SessionStatus, UserMessage } from "./types"

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

export function toV2Rules(rules?: PermissionRule[]) {
  return rules?.map((rule) => ({ action: rule.permission, resource: rule.pattern, effect: rule.action }))
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
  if ("content" in item) return textOf(item.content)
  return ""
}

function partsFromAssistant(sessionID: string, messageID: string, content: unknown[]): Part[] {
  return content.flatMap((item, index): Part[] => {
    const part = rec(item)
    if (!part) return []
    if (part.type === "text" || part.type === "reasoning") {
      return [{ id: `${messageID}:${part.type}:${index}`, sessionID, messageID, type: part.type, text: typeof part.text === "string" ? part.text : "" }]
    }
    if (part.type !== "tool") return []
    const state = rec(part.state)
    const status = state?.status
    const input = rec(state?.input)
    const base = { id: String(part.id ?? index), sessionID, messageID, type: "tool" as const, callID: String(part.id ?? index), tool: typeof part.name === "string" ? part.name : "" }
    if (status === "completed") return [{ ...base, state: { status: "completed", input, output: textOf(state?.content), metadata: rec(state?.metadata) } }]
    if (status === "error") return [{ ...base, state: { status: "error", input, error: textOf(state?.error) || "工具失败", metadata: rec(state?.metadata) } }]
    if (status === "running") return [{ ...base, state: { status: "running", input, metadata: rec(state?.metadata) } }]
    return [{ ...base, state: { status: "pending", input: typeof state?.input === "string" ? undefined : input, raw: typeof state?.input === "string" ? state.input : undefined } }]
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
      if (typeof row.text === "string" && row.text) parts.push({ id: `${id}:text`, sessionID, messageID: id, type: "text", text: row.text })
      messages.push({ info, parts })
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
      error: rec(row.error) ? { data: { message: textOf(row.error) } } : undefined,
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
    if (!providerID || !modelID) continue
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
