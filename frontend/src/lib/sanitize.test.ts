import { describe, expect, it } from "vitest"
import { sanitizeHtml } from "./sanitize"

describe("sanitizeHtml", () => {
  it("strips script tags and event handlers", () => {
    const dirty = `<img src=x onerror="alert(1)"><script>alert(2)</script><p>ok</p>`
    const clean = sanitizeHtml(dirty)
    expect(clean).not.toMatch(/onerror/i)
    expect(clean).not.toMatch(/<script/i)
    expect(clean).toContain("ok")
  })
})
