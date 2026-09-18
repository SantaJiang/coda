import { describe, expect, it } from "vitest"
import {
  LOCAL_COMPAT_API_KEY,
  looksLikeLMStudio,
  normalizeProviderBaseURL,
  presetById,
  PROVIDER_PRESETS,
} from "./presets"

describe("LM Studio preset", () => {
  it("is listed with an OpenAI-compatible /v1 base URL", () => {
    const preset = presetById("lmstudio")
    expect(preset?.name).toBe("LM Studio")
    expect(preset?.baseURL).toBe("http://127.0.0.1:1234/v1")
    expect(preset?.apiKeyOptional).toBe(true)
    expect(PROVIDER_PRESETS.some((item) => item.id === "lmstudio")).toBe(true)
  })
})

describe("normalizeProviderBaseURL", () => {
  it("appends /v1 for LM Studio host:1234 URLs that omit it", () => {
    expect(normalizeProviderBaseURL("http://192.168.111.151:1234", "lmstudio")).toBe("http://192.168.111.151:1234/v1")
    expect(normalizeProviderBaseURL("http://127.0.0.1:1234/")).toBe("http://127.0.0.1:1234/v1")
  })

  it("does not double the version path", () => {
    expect(normalizeProviderBaseURL("http://127.0.0.1:1234/v1/")).toBe("http://127.0.0.1:1234/v1")
    expect(normalizeProviderBaseURL("https://api.deepseek.com/v1")).toBe("https://api.deepseek.com/v1")
    expect(normalizeProviderBaseURL("https://open.bigmodel.cn/api/paas/v4")).toBe("https://open.bigmodel.cn/api/paas/v4")
  })

  it("treats LM Studio default port as a local compatible endpoint", () => {
    expect(looksLikeLMStudio("http://10.0.0.2:1234")).toBe(true)
    expect(looksLikeLMStudio("http://10.0.0.2:11434")).toBe(false)
    expect(LOCAL_COMPAT_API_KEY).toBe("lm-studio")
  })
})
