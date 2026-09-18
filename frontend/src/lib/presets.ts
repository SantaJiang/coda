export type ProviderPreset = {
  id: string
  name: string
  baseURL: string
  keyPlaceholder: string
  apiKeyOptional?: boolean
  hint?: string
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
  {
    id: "lmstudio",
    name: "LM Studio",
    baseURL: "http://127.0.0.1:1234/v1",
    keyPlaceholder: "可留空",
    apiKeyOptional: true,
    hint: "必须保留地址末尾的 /v1。本机默认 http://127.0.0.1:1234/v1；局域网把主机改成对应 IP，不要删掉 /v1。本地服务没有密钥时可留空。",
  },
]

export const CUSTOM_PRESET_ID = "custom"
export const LMSTUDIO_PRESET_ID = "lmstudio"
export const LOCAL_COMPAT_API_KEY = "lm-studio"

export function presetById(id: string) {
  return PROVIDER_PRESETS.find((item) => item.id === id)
}

export function presetByBaseURL(baseURL: string) {
  const normalized = baseURL.trim().replace(/\/+$/, "")
  return PROVIDER_PRESETS.find((item) => item.baseURL.replace(/\/+$/, "") === normalized)
}

function hasOpenAIVersionPath(pathname: string) {
  return /\/v\d+[a-z]*$/i.test(pathname) || /\/compatible-mode\/v\d+$/i.test(pathname)
}

export function looksLikeLMStudio(baseURL: string, providerID?: string) {
  if (providerID === LMSTUDIO_PRESET_ID) return true
  try {
    const parsed = new URL(baseURL.trim())
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/"
    return parsed.port === "1234" && (pathname === "/" || pathname === "/v1")
  } catch {
    return false
  }
}

export function isApiKeyOptional(baseURL: string, providerID?: string) {
  return presetById(providerID ?? "")?.apiKeyOptional === true || looksLikeLMStudio(baseURL, providerID)
}

export function normalizeProviderBaseURL(baseURL: string, providerID?: string) {
  const trimmed = baseURL.trim()
  if (!trimmed) return trimmed
  try {
    const parsed = new URL(trimmed)
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/"
    if (looksLikeLMStudio(trimmed, providerID) && !hasOpenAIVersionPath(pathname)) {
      parsed.pathname = pathname === "/" ? "/v1" : `${pathname}/v1`
    } else {
      parsed.pathname = pathname === "/" ? "" : pathname
    }
    parsed.hash = ""
    const serialized = parsed.toString().replace(/\/+$/, "")
    return serialized
  } catch {
    return trimmed.replace(/\/+$/, "")
  }
}
