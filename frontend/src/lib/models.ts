import { hasSharedValue, setSharedValue, sharedValue } from "./shared"
import { uid } from "./uid"
import { isApiKeyOptional, LOCAL_COMPAT_API_KEY, normalizeProviderBaseURL } from "./presets"
import { inputFromMedia, parseInputMedia, type InputMedia, type ModelInput } from "./model-input"

export type ModelRef = {
  providerID: string
  modelID: string
}

export type ConfiguredModel = {
  id: string
  name: string
  providerID: string
  providerName: string
  modelID: string
  baseURL: string
  apiKey: string
  inputModalities?: InputMedia[]
}

export type SelectableModel = {
  key: string
  providerID: string
  modelID: string
  name: string
  source: "coda" | "discovered"
  variants: string[]
  input?: ModelInput
  adapter?: string
}

export type ModelForm = {
  name: string
  providerID: string
  providerName: string
  modelID: string
  baseURL: string
  apiKey: string
  inputModalities?: InputMedia[]
}

export type BackendProviderConfig = {
  name?: string
  npm?: string
  options?: {
    apiKey?: string
    baseURL?: string
  }
  models?: Record<
    string,
    {
      id?: string
      name?: string
      tool_call?: boolean
      reasoning?: boolean
      temperature?: boolean
      attachment?: boolean
      modalities?: { input: string[]; output: string[] }
      limit?: { context: number; output: number }
    }
  >
}

export type ConfigPatch = {
  model?: string
  provider?: Record<string, BackendProviderConfig>
}

export type ProviderList = {
  all: Array<{
    id: string
    name: string
    models: Record<
      string,
      {
        id?: string
        name?: string
        variants?: Record<string, unknown>
        capabilities?: { input?: ModelInput }
        api?: { npm?: string }
      }
    >
  }>
  default: Record<string, string>
  connected: string[]
}

const STORAGE_MODELS = "coda.models"
const STORAGE_SECRETS = "coda.modelSecrets"
const STORAGE_SELECTED = "coda.selectedModel"
const STORAGE_PINNED = "coda.pinnedModels"

export const OPENCODE_PROVIDER_ID = "opencode"

// pinned 模型已下线：菜单只保留配置模型 + OpenCode 免费模型，清掉老版本留下的键。
export function clearRetiredModelStorage() {
  try {
    localStorage.removeItem(STORAGE_PINNED)
  } catch {
    // ignore when storage is unavailable
  }
}

function modelUid() {
  return uid("mdl")
}

export function modelKey(providerID: string, modelID: string) {
  return `${providerID}/${modelID}`
}

export function slugify(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "custom"
}

export function hostnameSlug(baseURL: string) {
  try {
    return slugify(new URL(baseURL.trim()).hostname)
  } catch {
    return "custom"
  }
}

export function resolveProviderID(form: Pick<ModelForm, "providerID" | "providerName" | "name" | "baseURL">) {
  const existing = form.providerID.trim()
  if (existing) {
    const lower = existing.toLowerCase()
    if (/^[a-z0-9][a-z0-9_-]*$/.test(lower)) return lower
    return slugify(existing)
  }
  const label = form.providerName.trim() || form.name.trim()
  const fromName = slugify(label)
  if (fromName !== "custom") return fromName
  return hostnameSlug(form.baseURL)
}

export function emptyModelForm(): ModelForm {
  return {
    name: "",
    providerID: "",
    providerName: "",
    modelID: "",
    baseURL: "",
    apiKey: "",
  }
}

function loadSecrets(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_SECRETS)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object") return {}
    const result: Record<string, string> = {}
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && value) result[id] = value
    }
    return result
  } catch {
    return {}
  }
}

function saveSecrets(models: ConfiguredModel[]) {
  const secrets: Record<string, string> = {}
  for (const model of models) {
    if (model.apiKey) secrets[model.id] = model.apiKey
  }
  localStorage.setItem(STORAGE_SECRETS, JSON.stringify(secrets))
}

function sanitizeModels(parsed: ConfiguredModel[], secrets: Record<string, string>): ConfiguredModel[] {
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter(
      (item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.providerID === "string" &&
        typeof item.modelID === "string",
    )
    .map((item) => ({
      ...item,
      inputModalities: parseInputMedia(item.inputModalities),
      apiKey: secrets[item.id] || item.apiKey || "",
    }))
}

export function loadConfiguredModels(): ConfiguredModel[] {
  const shared = sharedValue("models")
  if (Array.isArray(shared)) return sanitizeModels(shared, {})
  try {
    const raw = localStorage.getItem(STORAGE_MODELS)
    if (!raw) return []
    const parsed = JSON.parse(raw) as ConfiguredModel[]
    return sanitizeModels(parsed, loadSecrets())
  } catch {
    return []
  }
}

export function saveConfiguredModels(models: ConfiguredModel[]) {
  const publicModels = models.map((model) => ({
    id: model.id,
    name: model.name,
    providerID: model.providerID,
    providerName: model.providerName,
    modelID: model.modelID,
    baseURL: model.baseURL,
    ...(model.inputModalities ? { inputModalities: model.inputModalities } : {}),
  }))
  localStorage.setItem(STORAGE_MODELS, JSON.stringify(publicModels))
  saveSecrets(models)
  setSharedValue({ models })
}

export function loadSelectedModelKey() {
  if (hasSharedValue("selectedModelKey")) return sharedValue("selectedModelKey") ?? null
  return localStorage.getItem(STORAGE_SELECTED)
}

export function saveSelectedModelKey(key: string | null) {
  if (!key) localStorage.removeItem(STORAGE_SELECTED)
  else localStorage.setItem(STORAGE_SELECTED, key)
  setSharedValue({ selectedModelKey: key })
}

export function createConfiguredModel(form: ModelForm): ConfiguredModel {
  const baseURL = normalizeProviderBaseURL(form.baseURL, form.providerID)
  const providerName = form.providerName.trim() || form.name.trim() || hostnameSlug(baseURL)
  const name = form.name.trim() || form.modelID.trim()
  const providerID = resolveProviderID({ ...form, providerName, baseURL })
  return {
    id: modelUid(),
    name,
    providerID,
    providerName,
    modelID: form.modelID.trim(),
    baseURL,
    apiKey: form.apiKey.trim() || (isApiKeyOptional(baseURL, providerID) ? LOCAL_COMPAT_API_KEY : ""),
    ...(form.inputModalities ? { inputModalities: parseInputMedia(form.inputModalities) } : {}),
  }
}

export function validateFetchForm(form: Pick<ModelForm, "baseURL" | "apiKey"> & { providerID?: string }) {
  if (!form.baseURL.trim()) return "请填写接口地址"
  if (!form.apiKey.trim() && !isApiKeyOptional(form.baseURL, form.providerID)) return "请填写 API Key"
  try {
    const url = new URL(form.baseURL.trim())
    if (url.protocol !== "http:" && url.protocol !== "https:") return "接口地址需要是 http 或 https"
  } catch {
    return "接口地址不是合法 URL"
  }
  return null
}

export function validateProviderForm(form: Pick<ModelForm, "baseURL" | "apiKey" | "providerID" | "providerName" | "name">) {
  const endpoint = validateFetchForm(form)
  if (endpoint) return endpoint
  if (!(form.providerName.trim() || form.name.trim())) return "请填写接口名称"
  return null
}

export function variantKeys(model?: { variants?: Record<string, unknown> }) {
  return Object.keys(model?.variants ?? {})
}

export function formatVariantLabel(id: string) {
  if (!id || id === "default") return "Default"
  if (id === "xhigh") return "xHigh"
  return id.charAt(0).toUpperCase() + id.slice(1)
}

export function toSelectable(model: ConfiguredModel): SelectableModel {
  return {
    key: modelKey(model.providerID, model.modelID),
    providerID: model.providerID,
    modelID: model.modelID,
    name: model.name,
    source: "coda",
    variants: [],
    ...(model.inputModalities ? { input: inputFromMedia(model.inputModalities) } : {}),
  }
}

export function discoveredFromProviderList(list: ProviderList): SelectableModel[] {
  const connected = new Set(list.connected ?? [])
  const result: SelectableModel[] = []
  for (const provider of list.all ?? []) {
    if (!connected.has(provider.id)) continue
    for (const [id, model] of Object.entries(provider.models ?? {})) {
      const modelID = model.id || id
      result.push({
        key: modelKey(provider.id, modelID),
        providerID: provider.id,
        modelID,
        name: model.name || modelID,
        source: "discovered",
        variants: variantKeys(model),
        input: model.capabilities?.input,
        adapter: model.api?.npm,
      })
    }
  }
  return result
}

export function variantsByKey(list: ProviderList) {
  const map: Record<string, string[]> = {}
  for (const provider of list.all ?? []) {
    for (const [id, model] of Object.entries(provider.models ?? {})) {
      const modelID = model.id || id
      const keys = variantKeys(model)
      if (keys.length) map[modelKey(provider.id, modelID)] = keys
    }
  }
  return map
}

export function menuDiscoveredModels(discovered: SelectableModel[]) {
  return discovered.filter((item) => item.providerID === OPENCODE_PROVIDER_ID)
}

export function mergeSelectables(configured: ConfiguredModel[], discovered: SelectableModel[]) {
  const coda = configured.map(toSelectable)
  const extras = new Map(discovered.map((item) => [item.key, item]))
  const merged = coda.map((item) => {
    const extra = extras.get(item.key)
    return { ...item, ...(extra?.variants.length ? { variants: extra.variants } : {}), input: item.input ?? extra?.input, adapter: "@ai-sdk/openai-compatible" }
  })
  const seen = new Set(merged.map((item) => item.key))
  return [...merged, ...discovered.filter((item) => !seen.has(item.key))]
}

export function resolveSelectedKey(configured: ConfiguredModel[], selectables: SelectableModel[], stored: string | null) {
  if (stored && selectables.some((item) => item.key === stored)) return stored
  const first = configured[0]
  if (first) return modelKey(first.providerID, first.modelID)
  return selectables[0]?.key ?? null
}

export function toBackendPatch(models: ConfiguredModel[], selectedKey: string | null): ConfigPatch | null {
  if (models.length === 0) return null
  const provider: Record<string, BackendProviderConfig> = {}
  for (const model of models) {
    const current = provider[model.providerID] ?? {
      name: model.providerName || model.providerID,
      npm: "@ai-sdk/openai-compatible",
      options: {
        apiKey: model.apiKey,
        baseURL: model.baseURL,
      },
      models: {},
    }
    current.models = current.models ?? {}
    current.models[model.modelID] = {
      id: model.modelID,
      name: model.name,
      tool_call: true,
      reasoning: true,
      temperature: true,
      attachment: true,
      ...(model.inputModalities ? { modalities: { input: ["text", ...model.inputModalities], output: ["text"] } } : {}),
    }
    provider[model.providerID] = current
  }
  const configuredHit = Boolean(
    selectedKey && models.some((item) => modelKey(item.providerID, item.modelID) === selectedKey),
  )
  const selected = configuredHit
    ? selectedKey!
    : selectedKey?.startsWith(`${OPENCODE_PROVIDER_ID}/`)
      ? selectedKey
      : modelKey(models[0].providerID, models[0].modelID)
  return {
    model: selected,
    provider,
  }
}
