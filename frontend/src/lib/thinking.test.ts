import { describe, expect, it } from "vitest"
import { meaningfulThought, reasoningVisible, thinkingBody } from "./thinking"
import type { ReasoningPart } from "./types"

const reasoning = (text: string, end?: number): ReasoningPart => ({
  id: "r1",
  sessionID: "s1",
  messageID: "a1",
  type: "reasoning",
  text,
  time: end === undefined ? { start: 1 } : { start: 1, end },
})

describe("thinking visibility", () => {
  it("drops quote-only and blank husks", () => {
    expect(thinkingBody(reasoning(">\n>  ", 2))).toBe("")
    expect(thinkingBody(reasoning("   ", 2))).toBe("")
    expect(meaningfulThought(">\n>")).toBe("")
    expect(reasoningVisible(reasoning(">\n>", 2))).toBe(false)
  })

  it("keeps live shells until they finish empty", () => {
    expect(reasoningVisible(reasoning(""))).toBe(true)
    expect(thinkingBody(reasoning(""))).toBe("")
  })

  it("keeps real thought text and collapses spacer runs", () => {
    expect(thinkingBody(reasoning("先看结构\n\n\n\n再改", 2))).toBe("先看结构\n\n再改")
  })
})
