export type McpOAuthMethod = { id: string; type: "oauth"; label: string; hasForm: boolean }

export type McpIntegration = {
  id: string
  name: string
  methods: McpOAuthMethod[]
}

export type McpOAuthAttempt = {
  attemptID: string
  url: string
  instructions: string
  mode: "auto" | "code"
  paste: boolean
  lifetime: number
}

export type McpOAuthStatus =
  | { status: "pending" }
  | { status: "complete" }
  | { status: "failed"; message: string }
  | { status: "expired" }

export function integrationFrom(row: Record<string, unknown>): McpIntegration {
  const methods = Array.isArray(row.methods) ? row.methods : []
  return {
    id: typeof row.id === "string" ? row.id : "",
    name: typeof row.name === "string" ? row.name : "",
    methods: methods.flatMap((value) => {
      const method = value && typeof value === "object" ? (value as Record<string, unknown>) : undefined
      if (!method || method.type !== "oauth" || typeof method.id !== "string") return []
      return [{
        id: method.id,
        type: "oauth" as const,
        label: typeof method.label === "string" ? method.label : "",
        hasForm: Array.isArray(method.form) && method.form.length > 0,
      }]
    }),
  }
}

/** The backend registers remote MCP servers as integrations with a no-form OAuth method. */
export function interactiveOAuthMethod(integration: McpIntegration) {
  return integration.methods.find((method) => !method.hasForm)
}

export function oauthAttemptFrom(row: Record<string, unknown>): McpOAuthAttempt {
  const time = row.time && typeof row.time === "object" ? (row.time as Record<string, unknown>) : {}
  const created = typeof time.created === "number" ? time.created : 0
  const expires = typeof time.expires === "number" ? time.expires : created
  return {
    attemptID: typeof row.attemptID === "string" ? row.attemptID : "",
    url: typeof row.url === "string" ? row.url : "",
    instructions: typeof row.instructions === "string" ? row.instructions : "",
    mode: row.mode === "code" ? "code" : "auto",
    paste: row.paste === true,
    lifetime: Math.max(0, expires - created),
  }
}

export function oauthStatusFrom(row: Record<string, unknown>): McpOAuthStatus {
  if (row.status === "complete") return { status: "complete" }
  if (row.status === "expired") return { status: "expired" }
  if (row.status === "failed")
    return { status: "failed", message: typeof row.message === "string" ? row.message : "授权失败" }
  return { status: "pending" }
}
