export type RemoteModel = {
  id: string
  name: string
}

const SKIP = /embedding|whisper|tts|dall-e|moderation|tts-|audio|transcribe|realtime|image-edit|sora/i

function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

export function modelsEndpoint(baseURL: string) {
  return `${baseURL.trim().replace(/\/+$/, "")}/models`
}

function parseModels(body: unknown): RemoteModel[] {
  if (!body || typeof body !== "object") return []
  const record = body as Record<string, unknown>
  const rows = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models)
      ? record.models
      : Array.isArray(body)
        ? body
        : []
  const seen = new Set<string>()
  const result: RemoteModel[] = []
  for (const row of rows) {
    if (!row || typeof row !== "object") continue
    const item = row as Record<string, unknown>
    const raw = String(item.id || item.name || "").trim()
    if (!raw) continue
    const id = raw.replace(/^models\//, "")
    if (!id || SKIP.test(id) || seen.has(id)) continue
    seen.add(id)
    const name = String(item.display_name || item.name || id).replace(/^models\//, "")
    result.push({ id, name: name || id })
  }
  return result.sort((a, b) => a.id.localeCompare(b.id))
}

async function readError(response: Response) {
  const text = await response.text()
  try {
    const json = JSON.parse(text) as { error?: { message?: string }; message?: string }
    return json.error?.message || json.message || text || `${response.status}`
  } catch {
    return text || `${response.status}`
  }
}

async function requestModels(url: string, apiKey: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  }

  if (isTauri()) {
    const http = await import("@tauri-apps/plugin-http")
    return http.fetch(url, { method: "GET", headers })
  }

  if (import.meta.env.DEV) {
    return fetch("/__coda/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, apiKey }),
    })
  }

  return fetch(url, { method: "GET", headers })
}

export async function listRemoteModels(baseURL: string, apiKey: string): Promise<RemoteModel[]> {
  const url = modelsEndpoint(baseURL)
  const response = await requestModels(url, apiKey.trim() || "lm-studio")
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  const body = await response.json()
  const models = parseModels(body)
  if (models.length === 0) throw new Error("接口没有返回可用模型")
  return models
}
