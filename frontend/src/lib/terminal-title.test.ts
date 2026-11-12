import { describe, expect, it } from "vitest"
import { terminalGoalHints, terminalGoalTitle } from "./terminal-title"
import type { MessageWithParts, Part } from "./types"

const text = (id: string, value: string, synthetic = false): Part => ({
  id,
  sessionID: "one",
  messageID: id,
  type: "text",
  text: value,
  ...(synthetic ? { synthetic: true } : {}),
})

const shell = (id: string, shellID: string, command: string, description?: string): Part => ({
  id,
  sessionID: "one",
  messageID: id,
  type: "tool",
  callID: id,
  tool: "shell",
  state: {
    status: "running",
    input: { command, ...(description ? { description } : {}) },
    metadata: { shellID },
  },
})

const assistant = (id: string, parts: Part[]): MessageWithParts => ({
  info: { id, sessionID: "one", role: "assistant", time: { created: 1 } },
  parts,
})

const user = (id: string, parts: Part[]): MessageWithParts => ({
  info: { id, sessionID: "one", role: "user", time: { created: 1 } },
  parts,
})

describe("terminal goal titles", () => {
  it("uses the assistant's stated intent instead of the raw command", () => {
    const goals = terminalGoalHints([
      assistant("a1", [
        text("t1", "I'll inspect the download log to see why the Metal component is missing."),
        shell("s1", "sh_one", "p1=$(tr '\\r' '\\n' < /tmp/metal_dl4.log | tail -5)"),
      ]),
    ])
    expect(goals.get("sh_one")).toBe("Inspect the download log to see why the Metal component is missing")
  })

  it("prefers an explicit tool description", () => {
    const goals = terminalGoalHints([
      assistant("a1", [
        text("t1", "Let me run the checks."),
        shell("s1", "sh_two", "bun test", "Verify the login flow no longer loops"),
      ]),
    ])
    expect(goals.get("sh_two")).toBe("Verify the login flow no longer loops")
  })

  it("looks through synthetic tool-result rows and stops at a real user turn", () => {
    const goals = terminalGoalHints([
      assistant("a1", [text("t1", "Let me check whether the build output still exists.")]),
      user("u1", [text("u1", " shell result ", true)]),
      assistant("a2", [shell("s1", "sh_three", "ls -la dist")]),
      user("u2", [text("u2", "Now do something unrelated")]),
      assistant("a3", [shell("s2", "sh_four", "sleep 10")]),
    ])
    expect(goals.get("sh_three")).toBe("Check whether the build output still exists")
    expect(goals.has("sh_four")).toBe(false)
  })

  it("falls back to a goal phrase when no context is available", () => {
    expect(terminalGoalTitle("bun test")).toBe("运行测试并验证结果")
    expect(terminalGoalTitle("xcodebuild -scheme Coda")).toBe("构建 Xcode 项目")
    expect(terminalGoalTitle("chmod +x /tmp/build.sh && /tmp/build.sh")).toBe("准备脚本执行权限")
    expect(terminalGoalTitle("some-unknown-tool --flag")).toBe("执行终端任务")
  })

  it("never echoes a raw command as the goal", () => {
    expect(terminalGoalTitle("bun test", "bun test --watch")).toBe("运行测试并验证结果")
  })

  it("keeps a natural hint that mentions a file path intact", () => {
    expect(terminalGoalTitle("rg handler", "Check src/app.ts for the missing handler")).toBe(
      "Check src/app.ts for the missing handler",
    )
  })
})