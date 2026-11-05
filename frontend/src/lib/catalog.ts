import { INPUT_MEDIA, type InputMedia } from "./model-input"
import { isTauri } from "./platform-detect"

export type CatalogModel = {
  id: string
  name: string
  baseURL: string
  input: InputMedia[]
}

export type CatalogProvider = {
  id: string
  name: string
  env?: string
  models: CatalogModel[]
}

const CATALOG_URL = "https://models.opencode.ai/experimental/v2.0/api.json?type=chat,decision,image"
const COMPATIBLE_SDK = "@ai-sdk/openai-compatible"
// The free catalog provider already surfaces through the model menu.
const MENU_PROVIDER_ID = "opencode"

// The desktop CSP only allows same-origin connections, and the catalog host does
// not send CORS headers. Route the request through the Tauri HTTP plugin (Rust
// side, no CORS) or the dev proxy instead of calling fetch on the page directly.
async function requestCatalog() {
  const signal = AbortSignal.timeout(20_000)
  if (isTauri()) {
    const http = await import("@tauri-apps/plugin-http")
    return http.fetch(CATALOG_URL, { method: "GET", signal })
  }
  if (import.meta.env.DEV) return fetch("/__coda/catalog", { signal })
  return fetch(CATALOG_URL, { signal })
}

export async function fetchModelCatalog(): Promise<CatalogProvider[]> {
  const response = await requestCatalog()
  if (!response.ok) throw new Error(`目录加载失败（HTTP ${response.status}）`)
  return parseCatalog(await response.json())
}

export function parseCatalog(data: unknown): CatalogProvider[] {
  if (!isRecord(data)) return []
  const providers: CatalogProvider[] = []
  for (const [id, raw] of Object.entries(data)) {
    if (id === MENU_PROVIDER_ID || !isRecord(raw)) continue
    const models: CatalogModel[] = []
    for (const [modelID, model] of isRecord(raw.models) ? Object.entries(raw.models) : []) {
      if (!isRecord(model) || model.type !== "chat" || model.status === "deprecated") continue
      // Coda speaks the OpenAI-compatible protocol, so only catalog entries that declare it are addable.
      const chat = isRecord(model.api) ? model.api["chat-completions"] : undefined
      const sdk = isRecord(chat) && isRecord(chat.sdk) ? chat.sdk.aisdk : undefined
      const baseURL = isRecord(chat) && typeof chat.base_url === "string" ? chat.base_url.trim() : ""
      if (sdk !== COMPATIBLE_SDK || !baseURL) continue
      const inputRaw = isRecord(model.modalities) && Array.isArray(model.modalities.input) ? model.modalities.input : []
      const input: InputMedia[] = INPUT_MEDIA.filter((type) =>
        inputRaw.some((modality) => typeof modality === "string" && inputKind(modality) === type),
      )
      models.push({
        id: modelID,
        name: typeof model.name === "string" && model.name.trim() ? model.name.trim() : modelID,
        baseURL,
        input,
      })
    }
    if (!models.length) continue
    providers.push({
      id,
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : id,
      env: Array.isArray(raw.env) && typeof raw.env[0] === "string" ? raw.env[0] : undefined,
      models: models.sort((a, b) => a.name.localeCompare(b.name)),
    })
  }
  return providers.sort((a, b) => a.name.localeCompare(b.name))
}

function inputKind(modality: string): InputMedia | undefined {
  if (modality.startsWith("image/")) return "image"
  if (modality === "application/pdf") return "pdf"
  if (modality.startsWith("audio/")) return "audio"
  if (modality.startsWith("video/")) return "video"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

let cached: Promise<CatalogProvider[]> | undefined

/** One catalog fetch per app session; a failed fetch clears the cache so retry refetches. */
export function modelCatalog() {
  if (!cached) {
    cached = fetchModelCatalog()
    cached.catch(() => {
      cached = undefined
    })
  }
  return cached
}
