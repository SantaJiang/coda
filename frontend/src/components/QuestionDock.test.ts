import { describe, expect, it } from "vitest"
import { isRecommendedLabel } from "./QuestionDock"

describe("isRecommendedLabel", () => {
  it("does not treat 不推荐 as the recommended option", () => {
    expect(isRecommendedLabel("不推荐")).toBe(false)
    expect(isRecommendedLabel("使用（推荐）")).toBe(true)
    expect(isRecommendedLabel("Ship it (recommended)")).toBe(true)
  })
})
