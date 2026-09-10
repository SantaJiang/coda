import { describe, expect, it } from "vitest"
import { draftKey } from "./draft"

describe("draftKey", () => {
  it("prefers the session id", () => {
    expect(draftKey("sess-1", "prj-1")).toBe("session:sess-1")
  })

  it("falls back to a per-project draft key", () => {
    expect(draftKey(null, "prj-1")).toBe("draft:prj-1")
    expect(draftKey(undefined, null)).toBe("draft:_")
  })
})
