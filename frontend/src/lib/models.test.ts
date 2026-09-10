import { describe, expect, it } from "vitest"
import { toBackendPatch } from "./models"

describe("toBackendPatch", () => {
  it("marks configured models as attachment-capable and does not invent token limits", () => {
    const patch = toBackendPatch(
      [
        {
          id: "1",
          name: "gpt",
          providerID: "openai",
          providerName: "OpenAI",
          modelID: "gpt-4",
          baseURL: "https://api.openai.com/v1",
          apiKey: "sk-test",
        },
      ],
      "openai/gpt-4",
    )
    expect(patch?.provider?.openai?.models?.["gpt-4"]?.attachment).toBe(true)
    expect(patch?.provider?.openai?.models?.["gpt-4"]?.limit).toBeUndefined()
  })
})
