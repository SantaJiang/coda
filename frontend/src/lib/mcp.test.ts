import { expect, it } from "vitest"
import { buildMcpConfig, mcpDetail, splitCommand } from "./mcp"

it("splits a command without dropping quoted arguments", () => {
  expect(splitCommand(`npx -y "@scope/server" --root "/Users/me/My Project"`)).toEqual([
    "npx",
    "-y",
    "@scope/server",
    "--root",
    "/Users/me/My Project",
  ])
})

it("builds a remote server and rejects a bad assignment", () => {
  expect(buildMcpConfig({ name: "docs", type: "remote", command: "", url: "https://example.com/mcp", assignments: "Authorization=Bearer token" })).toEqual({
    name: "docs",
    server: { type: "remote", url: "https://example.com/mcp", headers: { Authorization: "Bearer token" } },
  })
  expect(buildMcpConfig({ name: "docs", type: "local", command: "echo hi", url: "", assignments: "no-equals" })).toEqual({
    error: "键值需要写成 KEY=VALUE：no-equals",
  })
})

it("describes a configured server from its command or url", () => {
  expect(mcpDetail({ type: "local", command: ["echo", "hi"] })).toBe("echo hi")
  expect(mcpDetail({ enabled: false })).toBe("")
})
