import { describe, expect, it } from "vitest"
import { formatSessionTitle } from "./session-label"

describe("formatSessionTitle", () => {
  it("falls back and rewrites default new-session titles", () => {
    expect(formatSessionTitle(undefined)).toBe("未命名会话")
    expect(formatSessionTitle("  ")).toBe("未命名会话")
    expect(formatSessionTitle("New session")).toBe("新会话")
    expect(formatSessionTitle("New session - foo")).toBe("新会话")
    expect(formatSessionTitle("修标题栏")).toBe("修标题栏")
  })
})
