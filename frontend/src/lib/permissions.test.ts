import { describe, expect, it } from "vitest"
import { autoReplyForMode } from "./permissions"

describe("autoReplyForMode", () => {
  it("lets readonly webfetch wait for the user", () => {
    expect(autoReplyForMode("readonly", "webfetch")).toBeNull()
    expect(autoReplyForMode("readonly", "read")).toBe("always")
    expect(autoReplyForMode("readonly", "bash")).toBe("reject")
  })
})
