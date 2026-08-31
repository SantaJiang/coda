export type ProviderPreset = {
  id: string
  name: string
  baseURL: string
  keyPlaceholder: string
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "anthropic",
    name: "Claude",
    baseURL: "https://api.anthropic.com/v1",
    keyPlaceholder: "sk-ant-...",
  },
  {
    id: "openai",
    name: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    keyPlaceholder: "sk-...",
  },
  {
    id: "gemini",
    name: "Gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyPlaceholder: "AIza...",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseURL: "https://api.deepseek.com/v1",
    keyPlaceholder: "sk-...",
  },
  {
    id: "glm",
    name: "GLM",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    keyPlaceholder: "API Key",
  },
  {
    id: "kimi",
    name: "Kimi",
    baseURL: "https://api.moonshot.cn/v1",
    keyPlaceholder: "sk-...",
  },
  {
    id: "qwen",
    name: "Qwen",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    keyPlaceholder: "sk-...",
  },
  {
    id: "minimax",
    name: "MiniMax",
    baseURL: "https://api.minimaxi.com/v1",
    keyPlaceholder: "API Key",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    keyPlaceholder: "sk-or-...",
  },
]

export const CUSTOM_PRESET_ID = "custom"

export function presetById(id: string) {
  return PROVIDER_PRESETS.find((item) => item.id === id)
}

export function presetByBaseURL(baseURL: string) {
  const normalized = baseURL.trim().replace(/\/+$/, "")
  return PROVIDER_PRESETS.find((item) => item.baseURL.replace(/\/+$/, "") === normalized)
}
