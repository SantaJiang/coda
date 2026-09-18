import { createConfiguredModel, hostnameSlug, type ConfiguredModel } from "./models"
import { normalizeProviderBaseURL } from "./presets"
import { parseImportedProviders, type ImportedProvider } from "./provider-import"

export const MODEL_CONFIG_KIND = "coda-models"
export const MODEL_CONFIG_VERSION = 1
export const MODEL_CONFIG_FILENAME = "coda-models.json"

export type ModelConfigImportMode = "replace" | "merge"

export type ExportedModel = {
  name: string
  providerID: string
  providerName: string
  modelID: string
  baseURL: string
  apiKey: string
}

export type ExportedModelConfig = {
  kind: typeof MODEL_CONFIG_KIND
  version: number
  models: ExportedModel[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function parseJson(raw: string): unknown {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error("文件是空的")
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

function configuredFromUnknown(value: unknown): ConfiguredModel | null {
  if (!isRecord(value)) return null
  const modelID = typeof value.modelID === "string" ? value.modelID.trim() : ""
  const baseURL = typeof value.baseURL === "string" ? value.baseURL.trim() : ""
  if (!modelID || !baseURL) return null
  const providerID = typeof value.providerID === "string" ? value.providerID.trim() : ""
  const providerName = typeof value.providerName === "string" ? value.providerName.trim() : ""
  const name = typeof value.name === "string" ? value.name.trim() : ""
  const apiKey = typeof value.apiKey === "string" ? value.apiKey : ""
  return createConfiguredModel({
    name: name || modelID,
    providerID,
    providerName: providerName || name || providerID,
    modelID,
    baseURL,
    apiKey,
  })
}

function fromParsed(parsed: unknown): ConfiguredModel[] {
  const list = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.models) ? parsed.models : null
  if (!list) return []
  return list.flatMap((item) => {
    const model = configuredFromUnknown(item)
    return model ? [model] : []
  })
}

function flattenImported(imported: ImportedProvider[]): ConfiguredModel[] {
  return imported.flatMap((provider) =>
    provider.models.map((model) =>
      createConfiguredModel({
        ...provider.form,
        modelID: model.id,
        name: model.name,
      }),
    ),
  )
}

function fromImportedProviders(raw: string): ConfiguredModel[] {
  const models = dedupeConfiguredModels(flattenImported(parseImportedProviders(raw)))
  if (!models.length) throw new Error("JSON 里没有可用的接口地址和模型")
  return models
}

export function endpointKey(model: Pick<ConfiguredModel, "baseURL" | "apiKey" | "providerID">) {
  return `${normalizeProviderBaseURL(model.baseURL, model.providerID)}\0${model.apiKey.trim()}`
}

export function modelIdentity(model: Pick<ConfiguredModel, "baseURL" | "apiKey" | "providerID" | "modelID">) {
  return `${endpointKey(model)}\0${model.modelID}`
}

export function serializeModelConfig(models: ConfiguredModel[]): string {
  const payload: ExportedModelConfig = {
    kind: MODEL_CONFIG_KIND,
    version: MODEL_CONFIG_VERSION,
    models: models.map((model) => ({
      name: model.name,
      providerID: model.providerID,
      providerName: model.providerName,
      modelID: model.modelID,
      baseURL: model.baseURL,
      apiKey: model.apiKey,
    })),
  }
  return `${JSON.stringify(payload, null, 2)}\n`
}

export function parseModelConfigFile(raw: string): ConfiguredModel[] {
  const trimmed = raw.replace(/^\uFEFF/, "").trim()
  if (!trimmed) throw new Error("文件是空的")
  try {
    const fromCoda = dedupeConfiguredModels(fromParsed(parseJson(trimmed)))
    if (fromCoda.length) return fromCoda
  } catch (error) {
    try {
      return fromImportedProviders(trimmed)
    } catch {
      throw error instanceof Error ? error : new Error("不是合法 JSON")
    }
  }
  return fromImportedProviders(trimmed)
}

export function dedupeConfiguredModels(models: ConfiguredModel[]): ConfiguredModel[] {
  const seen = new Set<string>()
  const result: ConfiguredModel[] = []
  for (const model of models) {
    const key = modelIdentity(model)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(model)
  }
  return result
}

function unusedProviderID(base: string, taken: Set<string>) {
  const root = base.trim() || "custom"
  if (!taken.has(root)) return root
  let n = 2
  while (taken.has(`${root}-${n}`)) n++
  return `${root}-${n}`
}

export function uniquifyProviderIDs(models: ConfiguredModel[]): ConfiguredModel[] {
  const endpointProvider = new Map<string, Pick<ConfiguredModel, "providerID" | "providerName">>()
  const taken = new Set<string>()
  return models.map((model) => {
    const ep = endpointKey(model)
    const existing = endpointProvider.get(ep)
    if (existing) return { ...model, providerID: existing.providerID, providerName: existing.providerName }

    const requested = model.providerID.trim() || "custom"
    const providerID = unusedProviderID(requested, taken)
    let providerName = model.providerName
    if (providerID !== requested) {
      const host = hostnameSlug(model.baseURL)
      const label = model.providerName.trim() || requested
      if (host && host !== "custom" && !label.toLowerCase().includes(host)) {
        providerName = `${label} (${host})`
      }
    }
    taken.add(providerID)
    const mapped = { providerID, providerName }
    endpointProvider.set(ep, mapped)
    return { ...model, ...mapped }
  })
}

export function replaceConfiguredModels(incoming: ConfiguredModel[]): ConfiguredModel[] {
  return uniquifyProviderIDs(dedupeConfiguredModels(incoming))
}

export function mergeConfiguredModels(local: ConfiguredModel[], incoming: ConfiguredModel[]): ConfiguredModel[] {
  const base = dedupeConfiguredModels(local)
  const incomingUnique = dedupeConfiguredModels(incoming)
  const byIdentity = new Set(base.map(modelIdentity))
  const providerByEndpoint = new Map<string, Pick<ConfiguredModel, "providerID" | "providerName">>()
  for (const model of base) {
    const key = endpointKey(model)
    if (!providerByEndpoint.has(key)) {
      providerByEndpoint.set(key, { providerID: model.providerID, providerName: model.providerName })
    }
  }
  const result = [...base]
  for (const model of incomingUnique) {
    if (byIdentity.has(modelIdentity(model))) continue
    const localProvider = providerByEndpoint.get(endpointKey(model))
    const next = localProvider
      ? { ...model, providerID: localProvider.providerID, providerName: localProvider.providerName }
      : model
    result.push(next)
    byIdentity.add(modelIdentity(next))
  }
  return uniquifyProviderIDs(result)
}
