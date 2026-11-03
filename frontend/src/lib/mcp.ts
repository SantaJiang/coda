export type McpServerConfig =
  | {
      type: "local"
      command: string[]
      environment?: Record<string, string>
      enabled?: boolean
    }
  | {
      type: "remote"
      url: string
      headers?: Record<string, string>
      enabled?: boolean
    }

export type McpConfigEntry = McpServerConfig | { enabled: boolean }

export type McpStatus =
  | { status: "connected" }
  | { status: "disabled" }
  | { status: "failed"; error: string }
  | { status: "needs_auth" }
  | { status: "needs_client_registration"; error: string }

export type McpStatusMap = Record<string, McpStatus>

const NAME = /^[A-Za-z0-9._-]{1,64}$/

export function validMcpName(name: string) {
  return NAME.test(name)
}

export function splitCommand(input: string) {
  const parts: string[] = []
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g
  for (const match of input.matchAll(pattern)) parts.push(match[1] ?? match[2] ?? match[3] ?? "")
  return parts.filter((part) => part.length > 0)
}

export function parseAssignments(input: string) {
  const entries: Record<string, string> = {}
  for (const line of input.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const index = trimmed.indexOf("=")
    if (index < 1) return trimmed
    const key = trimmed.slice(0, index).trim()
    if (!key) return trimmed
    entries[key] = trimmed.slice(index + 1)
  }
  return entries
}

export function mcpDetail(config: McpConfigEntry | undefined) {
  if (!config || !("type" in config)) return ""
  return config.type === "remote" ? config.url : config.command.join(" ")
}

export function mcpStatusLabel(status: McpStatus["status"]) {
  if (status === "connected") return "已连接"
  if (status === "disabled") return "已停用"
  if (status === "needs_auth") return "需授权"
  if (status === "needs_client_registration") return "需注册"
  return "连接失败"
}

export function buildMcpConfig(input: {
  name: string
  type: "local" | "remote"
  command: string
  url: string
  assignments: string
}): { name: string; server: McpServerConfig } | { error: string } {
  const name = input.name.trim()
  if (!validMcpName(name)) return { error: "名称只能包含字母、数字、点、下划线和横线" }
  const assignments = parseAssignments(input.assignments)
  if (typeof assignments === "string") return { error: `键值需要写成 KEY=VALUE：${assignments}` }
  const extra = Object.keys(assignments).length ? assignments : undefined
  if (input.type === "remote") {
    const url = input.url.trim()
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return { error: "请填写 http 或 https 地址" }
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { error: "请填写 http 或 https 地址" }
    return { name, server: { type: "remote", url, ...(extra ? { headers: extra } : {}) } }
  }
  const command = splitCommand(input.command)
  if (!command.length) return { error: "请填写启动命令" }
  return { name, server: { type: "local", command, ...(extra ? { environment: extra } : {}) } }
}
