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
}

export type SelectableModel = {
  key: string
  providerID: string
  modelID: string
  name: string
  source: "coda" | "discovered"
  variants: string[]
}

export type ModelForm = {
  name: string
  providerID: string
  providerName: string
  modelID: string
  baseURL: string
  apiKey: string
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
      }
    >
  }>
  default: Record<string, string>
  connected: string[]
}

const STORAGE_MODELS = "coda.models"
const STORAGE_SELECTED = "coda.selectedModel"
const STORAGE_PINNED = "coda.pinnedModels"

function uid() {
  return `mdl_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
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

export function formFromModel(model: ConfiguredModel): ModelForm {
  return {
    name: model.name,
    providerID: model.providerID,
    providerName: model.providerName,
    modelID: model.modelID,
    baseURL: model.baseURL,
    apiKey: model.apiKey,
  }
}

export function loadConfiguredModels(): ConfiguredModel[] {
  try {
    const raw = localStorage.getItem(STORAGE_MODELS)
    if (!raw) return []
    const parsed = JSON.parse(raw) as ConfiguredModel[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.providerID === "string" &&
        typeof item.modelID === "string",
    )
  } catch {
    return []
  }
}

export function saveConfiguredModels(models: ConfiguredModel[]) {
  localStorage.setItem(STORAGE_MODELS, JSON.stringify(models))
}

export function loadSelectedModelKey() {
  return localStorage.getItem(STORAGE_SELECTED)
}

export function saveSelectedModelKey(key: string | null) {
  if (!key) localStorage.removeItem(STORAGE_SELECTED)
  else localStorage.setItem(STORAGE_SELECTED, key)
}

export function loadPinnedModelKeys(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_PINNED)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

export function savePinnedModelKeys(keys: string[]) {
  localStorage.setItem(STORAGE_PINNED, JSON.stringify(keys))
}

export function createConfiguredModel(form: ModelForm): ConfiguredModel {
  const name = form.name.trim() || form.modelID.trim()
  const providerID = slugify(form.providerID || form.providerName || name)
  return {
    id: uid(),
    name,
    providerID,
    providerName: form.providerName.trim() || name,
    modelID: form.modelID.trim(),
    baseURL: form.baseURL.trim().replace(/\/+$/, ""),
    apiKey: form.apiKey.trim(),
  }
}

export function updateConfiguredModel(model: ConfiguredModel, form: ModelForm): ConfiguredModel {
  const next = createConfiguredModel(form)
  return { ...next, id: model.id }
}

export function validateProviderForm(form: Pick<ModelForm, "baseURL" | "apiKey" | "providerID" | "providerName" | "name">) {
  if (!form.baseURL.trim()) return "请填写接口地址"
  if (!form.apiKey.trim()) return "请填写 API Key"
  if (!slugify(form.providerID || form.providerName || form.name)) return "请选择或填写供应商"
  try {
    const url = new URL(form.baseURL.trim())
    if (url.protocol !== "http:" && url.protocol !== "https:") return "接口地址需要是 http 或 https"
  } catch {
    return "接口地址不是合法 URL"
  }
  return null
}

export function validateModelForm(form: ModelForm) {
  if (!form.modelID.trim()) return "请填写模型 ID"
  return validateProviderForm(form)
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

export function mergeSelectables(configured: ConfiguredModel[], discovered: SelectableModel[]) {
  const coda = configured.map(toSelectable)
  const extras = new Map(discovered.map((item) => [item.key, item]))
  const merged = coda.map((item) => {
    const extra = extras.get(item.key)
    return extra?.variants.length ? { ...item, variants: extra.variants } : item
  })
  const seen = new Set(merged.map((item) => item.key))
  return [...merged, ...discovered.filter((item) => !seen.has(item.key))]
}

export function resolveSelectedKey(configured: ConfiguredModel[], selectables: SelectableModel[], stored: string | null) {
  if (stored && selectables.some((item) => item.key === stored)) return stored
  const first = configured[0]
  return first ? modelKey(first.providerID, first.modelID) : null
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
      attachment: false,
      limit: { context: 128000, output: 8192 },
    }
    provider[model.providerID] = current
  }
  const selected = selectedKey && models.some((item) => modelKey(item.providerID, item.modelID) === selectedKey)
    ? selectedKey
    : modelKey(models[0].providerID, models[0].modelID)
  return {
    model: selected,
    provider,
  }
}
