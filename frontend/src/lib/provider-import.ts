import { emptyModelForm, type ModelForm } from "./models"
import { CUSTOM_PRESET_ID, presetByBaseURL, presetById } from "./presets"
import { parseInputMedia, type InputMedia } from "./model-input"

export type ImportedModel = {
  id: string
  name: string
  inputModalities?: InputMedia[]
}

export type ImportedProvider = {
  form: ModelForm
  models: ImportedModel[]
}

type ProviderOptions = {
  apiKey?: unknown
  baseURL?: unknown
  headers?: unknown
}

type ProviderLike = {
  name?: unknown
  npm?: unknown
  options?: ProviderOptions
  models?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function parseJsonish(raw: string): unknown {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error("请粘贴供应商 JSON")
  const candidates = [trimmed, `{${trimmed}}`, `[${trimmed}]`]
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      // try the next wrapping
    }
  }
  throw new Error("不是合法 JSON")
}

function headerValue(headers: unknown, name: string) {
  if (!isRecord(headers)) return ""
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name.toLowerCase() && typeof value === "string") return value
  }
  return ""
}

export function extractApiKey(options?: ProviderOptions) {
  if (typeof options?.apiKey === "string" && options.apiKey.trim()) return options.apiKey.trim()
  const auth = headerValue(options?.headers, "authorization").replace(/^Bearer\s+/i, "").trim()
  if (auth) return auth
  return headerValue(options?.headers, "x-api-key").trim() || headerValue(options?.headers, "api-key").trim()
}

function modelEntries(models: unknown): ImportedModel[] {
  if (!isRecord(models)) return []
  const result: ImportedModel[] = []
  for (const [key, value] of Object.entries(models)) {
    if (typeof value === "string") {
      const id = value.trim() || key
      result.push({ id, name: id })
      continue
    }
    if (!isRecord(value)) continue
    const id = String(value.id || key).trim()
    if (!id) continue
    const name = String(value.name || id).trim() || id
    const modalities = isRecord(value.modalities) ? value.modalities.input : undefined
    result.push({ id, name, inputModalities: parseInputMedia(value.inputModalities ?? modalities) })
  }
  return result
}

function asProviderLike(value: unknown): ProviderLike | null {
  if (!isRecord(value)) return null
  const options = isRecord(value.options) ? (value.options as ProviderOptions) : undefined
  if (typeof options?.baseURL === "string" || isRecord(value.models) || typeof value.npm === "string") {
    return value as ProviderLike
  }
  return null
}

function importedFromProvider(id: string, provider: ProviderLike): ImportedProvider | null {
  const options = isRecord(provider.options) ? (provider.options as ProviderOptions) : undefined
  const baseURL = typeof options?.baseURL === "string" ? options.baseURL.trim() : ""
  if (!baseURL) return null
  const models = modelEntries(provider.models)
  const providerName = String(provider.name || id).trim() || id
  const preset = presetById(id)
  return {
    form: {
      name: preset?.name || providerName,
      providerID: preset?.id || id,
      providerName: preset?.name || providerName,
      modelID: models[0]?.id ?? "",
      baseURL,
      apiKey: extractApiKey(options),
    },
    models,
  }
}

function importedFromConfigured(models: unknown[]): ImportedProvider[] {
  const groups = new Map<string, ImportedProvider>()
  for (const item of models) {
    if (!isRecord(item)) continue
    const providerID = typeof item.providerID === "string" ? item.providerID.trim() : ""
    const modelID = typeof item.modelID === "string" ? item.modelID.trim() : ""
    const baseURL = typeof item.baseURL === "string" ? item.baseURL.trim() : ""
    if (!providerID || !modelID || !baseURL) continue
    const providerName = typeof item.providerName === "string" && item.providerName.trim() ? item.providerName : providerID
    const name = typeof item.name === "string" && item.name.trim() ? item.name : modelID
    const apiKey = typeof item.apiKey === "string" ? item.apiKey : ""
    const groupKey = `${providerID}\0${baseURL}`
    const current = groups.get(groupKey) ?? {
      form: {
        ...emptyModelForm(),
        name: providerName,
        providerID,
        providerName,
        modelID,
        baseURL,
        apiKey,
      },
      models: [],
    }
    if (!current.form.apiKey && apiKey) current.form.apiKey = apiKey
    else if (apiKey && current.form.apiKey && apiKey !== current.form.apiKey) {
      const splitKey = `${groupKey}\0${apiKey}`
      const split = groups.get(splitKey) ?? {
        form: {
          ...emptyModelForm(),
          name: providerName,
          providerID,
          providerName,
          modelID,
          baseURL,
          apiKey,
        },
        models: [],
      }
      split.models.push({ id: modelID, name, inputModalities: parseInputMedia(item.inputModalities) })
      groups.set(splitKey, split)
      continue
    }
    current.models.push({ id: modelID, name, inputModalities: parseInputMedia(item.inputModalities) })
    groups.set(groupKey, current)
  }
  const used = new Set<string>()
  for (const group of groups.values()) {
    let id = group.form.providerID
    if (used.has(id)) {
      let suffix = 2
      while (used.has(`${group.form.providerID}-${suffix}`)) suffix += 1
      id = `${group.form.providerID}-${suffix}`
      group.form.providerID = id
    }
    used.add(id)
  }
  return [...groups.values()]
}

function importedFromMap(value: Record<string, unknown>): ImportedProvider[] {
  const result: ImportedProvider[] = []
  for (const [id, item] of Object.entries(value)) {
    const provider = asProviderLike(item)
    if (!provider) continue
    const imported = importedFromProvider(id, provider)
    if (imported) result.push(imported)
  }
  return result
}

export function parseImportedProviders(raw: string): ImportedProvider[] {
  const parsed = parseJsonish(raw)
  if (Array.isArray(parsed)) return importedFromConfigured(parsed)
  if (!isRecord(parsed)) throw new Error("无法识别这份供应商配置")

  if (Array.isArray(parsed.models)) return importedFromConfigured(parsed.models)

  if (isRecord(parsed.provider)) {
    const fromMap = importedFromMap(parsed.provider)
    if (fromMap.length) return fromMap
  }

  const single = asProviderLike(parsed)
  if (single) {
    const imported = importedFromProvider(String(parsed.id || parsed.name || "custom"), single)
    if (imported) return [imported]
  }

  const fromMap = importedFromMap(parsed)
  if (fromMap.length) return fromMap
  throw new Error("JSON 里没有可用的接口地址和模型")
}

export function importedPresetId(imported: ImportedProvider) {
  return presetById(imported.form.providerID)?.id ?? presetByBaseURL(imported.form.baseURL)?.id ?? CUSTOM_PRESET_ID
}
