import { API_BASE } from "./config"
import { createClientMcpTicket } from "./api"

export type ClientMcpTool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  run: (args: Record<string, unknown>) => string | Promise<string>
}

export type ClientMcpConnection = {
  close: () => void
}

type Rpc = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown }

function result(id: unknown, value: unknown) {
  return JSON.stringify({ jsonrpc: "2.0", id, result: value })
}

function failure(id: unknown, code: number, message: string) {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })
}

function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** One JSON-RPC frame in, one frame out. Notifications return null. Pure enough for unit tests. */
export async function handleClientMcpFrame(text: string, tools: ClientMcpTool[]): Promise<string | null> {
  let message: Rpc
  try {
    message = JSON.parse(text) as Rpc
  } catch {
    return failure(null, -32700, "Invalid JSON")
  }
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") return failure(message.id ?? null, -32600, "Invalid request")
  const id = message.id
  const params = objectOf(message.params)
  const notification = id === undefined || id === null
  if (message.method.startsWith("notifications/")) return null

  switch (message.method) {
    case "initialize":
      return result(id, {
        protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "coda-client", version: "1.0.0" },
      })
    case "ping":
      return result(id, {})
    case "tools/list":
      return result(id, {
        tools: tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
      })
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : ""
      const tool = tools.find((item) => item.name === name)
      if (!tool) return notification ? null : failure(id, -32602, `Unknown tool: ${name}`)
      try {
        const text = await tool.run(objectOf(params.arguments))
        return notification ? null : result(id, { content: [{ type: "text", text }] })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return notification ? null : result(id, { content: [{ type: "text", text: message }], isError: true })
      }
    }
    case "resources/list":
      return notification ? null : result(id, { resources: [] })
    case "resources/templates/list":
      return notification ? null : result(id, { resourceTemplates: [] })
    case "prompts/list":
      return notification ? null : result(id, { prompts: [] })
    default:
      return notification ? null : failure(id, -32601, `Method not found: ${message.method}`)
  }
}

function socketURL(name: string, ticket: string, directory: string) {
  const url = new URL("/api/experimental/client-mcp", API_BASE)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.searchParams.set("location[directory]", directory)
  url.searchParams.set("name", name)
  url.searchParams.set("ticket", ticket)
  return url.toString()
}

/** The browser hosts an MCP server for as long as the WebSocket stays open. */
export async function connectClientMcp(input: {
  directory: string
  name: string
  tools: ClientMcpTool[]
  onStatus: (status: "connecting" | "connected" | "disconnected") => void
  onError?: (message: string) => void
}): Promise<ClientMcpConnection> {
  const { ticket } = await createClientMcpTicket(input.directory, input.name)
  const socket = new WebSocket(socketURL(input.name, ticket, input.directory))
  input.onStatus("connecting")

  socket.addEventListener("open", () => input.onStatus("connected"))
  socket.addEventListener("message", (event) => {
    void handleClientMcpFrame(String(event.data), input.tools).then((reply) => {
      if (reply && socket.readyState === WebSocket.OPEN) socket.send(reply)
    })
  })
  socket.addEventListener("error", () => {
    input.onStatus("disconnected")
    input.onError?.("客户端 MCP 连接失败")
  })
  socket.addEventListener("close", () => input.onStatus("disconnected"))

  return {
    close: () => socket.close(),
  }
}
