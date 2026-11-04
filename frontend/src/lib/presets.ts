export const LMSTUDIO_PRESET_ID = "lmstudio"
export const LOCAL_COMPAT_API_KEY = "lm-studio"

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
  return looksLikeLMStudio(baseURL, providerID)
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
