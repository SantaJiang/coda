import { describe, expect, it } from "vitest"
import { parseCatalog } from "./catalog"

const catalog = {
  "zai": {
    "id": "zai",
    "name": "Z.AI",
    "env": ["ZHIPU_API_KEY"],
    "models": {
      "glm-5.3": {
        "id": "glm-5.3",
        "type": "chat",
        "name": "GLM-5.3",
        "modalities": { "input": ["text"], "output": ["text"] },
        "api": { "chat-completions": { "base_url": "https://api.z.ai/api/paas/v4", "sdk": { "aisdk": "@ai-sdk/openai-compatible" } } },
      },
      "glm-5.3-flash": {
        "id": "glm-5.3-flash",
        "type": "chat",
        "name": "GLM-5.3-Flash",
        "modalities": { "input": ["text", "image/png", "image/jpeg", "video/mp4", "application/pdf"], "output": ["text"] },
        "api": { "chat-completions": { "base_url": "https://api.z.ai/api/paas/v4", "sdk": { "aisdk": "@ai-sdk/openai-compatible" } } },
      },
      "glm-deprecated": {
        "id": "glm-deprecated",
        "type": "chat",
        "status": "deprecated",
        "api": { "chat-completions": { "base_url": "https://api.z.ai/api/paas/v4", "sdk": { "aisdk": "@ai-sdk/openai-compatible" } } },
      },
      "glm-imagegen": {
        "id": "glm-imagegen",
        "type": "image",
        "api": { "chat-completions": { "base_url": "https://api.z.ai/api/paas/v4", "sdk": { "aisdk": "@ai-sdk/openai-compatible" } } },
      },
    },
  },
  "anthropic": {
    "id": "anthropic",
    "name": "Anthropic",
    "models": {
      "claude": {
        "id": "claude",
        "type": "chat",
        "name": "Claude",
        "api": { "chat-completions": { "base_url": "https://api.anthropic.com/v1", "sdk": { "aisdk": "@ai-sdk/anthropic" } } },
      },
    },
  },
  "opencode": {
    "id": "opencode",
    "name": "OpenCode",
    "models": {
      "free": { "id": "free", "type": "chat", "api": { "chat-completions": { "base_url": "https://opencode.ai/v1", "sdk": { "aisdk": "@ai-sdk/openai-compatible" } } } },
    },
  },
  "broken": { "id": "broken", "models": "not-a-record" },
}

describe("parseCatalog", () => {
  it("keeps only chat models on compatible endpoints with their real input capabilities", () => {
    const providers = parseCatalog(catalog)
    expect(providers.map((provider) => provider.id)).toEqual(["zai"])
    const [zai] = providers
    expect(zai.name).toBe("Z.AI")
    expect(zai.env).toBe("ZHIPU_API_KEY")
    expect(zai.models.map((model) => model.id)).toEqual(["glm-5.3", "glm-5.3-flash"])
    expect(zai.models[0].input).toEqual([])
    expect(zai.models[1].input).toEqual(["image", "pdf", "video"])
    expect(zai.models[0].baseURL).toBe("https://api.z.ai/api/paas/v4")
  })
  it("tolerates malformed input", () => {
    expect(parseCatalog(null)).toEqual([])
    expect(parseCatalog("nope")).toEqual([])
    expect(parseCatalog({ "broken": catalog.broken })).toEqual([])
  })
})
