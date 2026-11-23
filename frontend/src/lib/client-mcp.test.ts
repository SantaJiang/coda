import { expect, it } from "vitest"
import { handleClientMcpFrame, type ClientMcpTool } from "./client-mcp"

const tools: ClientMcpTool[] = [
  {
    name: "echo",
    description: "echo text",
    inputSchema: { type: "object", properties: { text: { type: "string" } } },
    run: async ({ text }) => String(text ?? ""),
  },
]

it("answers the MCP initialize and tools/list handshake", async () => {
  const init = JSON.parse((await handleClientMcpFrame(JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" },
  }), tools))!)
  expect(init).toMatchObject({ id: 1, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} } } })

  const list = JSON.parse((await handleClientMcpFrame(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }), tools))!)
  expect(list.result.tools.map((tool: { name: string }) => tool.name)).toEqual(["echo"])
})

it("calls a hosted tool and ignores notifications", async () => {
  const called = JSON.parse((await handleClientMcpFrame(JSON.stringify({
    jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { text: "hi" } },
  }), tools))!)
  expect(called.result).toEqual({ content: [{ type: "text", text: "hi" }] })
  expect(await handleClientMcpFrame(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), tools)).toBeNull()
})

it("returns MCP errors for invalid frames and unknown methods", async () => {
  expect(JSON.parse((await handleClientMcpFrame("not json", tools))!).error.code).toBe(-32700)
  expect(JSON.parse((await handleClientMcpFrame(JSON.stringify({ jsonrpc: "2.0", id: 9, method: "unknown" }), tools))!).error.code).toBe(-32601)
})
