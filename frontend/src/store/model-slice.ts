import {
  mergeConfiguredModels,
  replaceConfiguredModels,
  type ModelConfigImportMode,
} from "../lib/model-config-file"
import {
  createConfiguredModel,
  discoveredFromProviderList,
  formatVariantLabel,
  menuDiscoveredModels,
  mergeSelectables,
  modelKey,
  rememberSelectedVariant,
  resolveSelectedKey,
  saveConfiguredModels,
  saveSelectedModelKey,
  selectedVariantFor,
  variantsByKey,
  type ConfiguredModel,
  type ModelForm,
} from "../lib/models"
import { popoverPatch, type AppState } from "./state"
import { parseInputMedia, type InputMedia } from "../lib/model-input"
import type { ModelApi } from "./contracts"
import { createBackendConfigSync } from "./backend-config"
import { selectedProjectOf, type StoreHandle } from "./handle"

export function selectableModelsOf(state: AppState) {
  return mergeSelectables(state.configuredModels, state.discoveredModels).filter((model) => model.source === "coda" || model.providerID === "opencode")
}

export function selectedModelOf(state: AppState) {
  return selectableModelsOf(state).find((item) => item.key === state.selectedModelKey)
}

export function variantsForKey(state: AppState, key: string | null) {
  if (!key) return []
  return state.modelVariants[key] ?? selectableModelsOf(state).find((item) => item.key === key)?.variants ?? []
}

// The variant list arrives asynchronously with model discovery. Until then a
// saved choice cannot be validated, so keep it and let discovery reconcile it.
export function storedVariantFor(state: AppState, key: string | null) {
  const stored = selectedVariantFor(key)
  if (!stored) return null
  const variants = variantsForKey(state, key)
  if (!state.modelDiscoveryReady && variants.length === 0) return stored
  return variants.includes(stored) ? stored : null
}

export function persistSelection(handle: StoreHandle, key: string | null) {
  handle.setState("selectedModelKey", key)
  saveSelectedModelKey(key)
}

export function createModelSlice(handle: StoreHandle, config = createBackendConfigSync(handle)): ModelApi {
  const { state, setState, client } = handle

  const selectableModels = () => selectableModelsOf(state)
  const selectedModel = () => selectedModelOf(state)

  const applyConfiguredModels = async (models: ConfiguredModel[], preferredKey?: string | null) => {
    const extras = menuDiscoveredModels(state.discoveredModels)
    const selectables = mergeSelectables(models, extras)
    const nextKey = resolveSelectedKey(models, selectables, preferredKey ?? state.selectedModelKey, state.modelDiscoveryReady)
    setState("configuredModels", models)
    persistSelection(handle, nextKey)
    setState("selectedVariant", storedVariantFor(state, nextKey))
    saveConfiguredModels(models)
    await config.sync()
  }

  let discoveredGen = 0
  const refreshDiscovered = async () => {
    const gen = ++discoveredGen
    try {
      const project = selectedProjectOf(state)
      const list = await client.listProviders(project?.missing ? undefined : project?.path)
      if (gen !== discoveredGen) return
      const discovered = discoveredFromProviderList(list)
      setState("discoveredModels", discovered)
      setState("modelVariants", variantsByKey(list))
      setState("modelDiscoveryReady", true)
      const extras = menuDiscoveredModels(discovered)
      const nextKey = resolveSelectedKey(
        state.configuredModels,
        mergeSelectables(state.configuredModels, extras),
        state.selectedModelKey,
      )
      persistSelection(handle, nextKey)
      setState("selectedVariant", storedVariantFor(state, nextKey))
    } catch {
      if (gen !== discoveredGen || state.discoveredModels.length > 0) return
      setState("discoveredModels", [])
    }
  }

  return {
    selectableModels,
    selectedModel,
    selectedModelKey: () => state.selectedModelKey,
    selectedVariant: () => state.selectedVariant,
    currentVariants: () => variantsForKey(state, state.selectedModelKey),
    variantLabel: () => formatVariantLabel(state.selectedVariant ?? "default"),
    modelMenuOpen: () => state.modelMenuOpen,
    variantMenuOpen: () => state.variantMenuOpen,
    modelSettingsOpen: () => state.modelSettingsOpen,
    modelSettingsError: () => state.modelSettingsError,
    configuredModels: () => state.configuredModels,
    selectModel: (key) => {
      persistSelection(handle, key)
      setState({
        ...popoverPatch(null),
        selectedVariant: storedVariantFor(state, key),
      })
    },
    openModelMenu: () => {
      setState(popoverPatch("model"))
      void refreshDiscovered()
    },
    closeModelMenu: () => setState("modelMenuOpen", false),
    openModelSettings: () => setState({ modelMenuOpen: false, modelSettingsOpen: true, modelSettingsError: null }),
    closeModelSettings: () => setState({ modelSettingsOpen: false, modelSettingsError: null }),
    saveConfiguredProvider: async (form: ModelForm, modelIDs: string[], modelNames?: Record<string, string>, modelInputs?: Record<string, InputMedia[]>) => {
      setState("modelSettingsError", null)
      const unique = [...new Set(modelIDs.map((item) => item.trim()).filter(Boolean))]
      if (unique.length === 0) {
        setState("modelSettingsError", "请至少勾选一个模型")
        return
      }
      const sample = createConfiguredModel({ ...form, modelID: unique[0], name: modelNames?.[unique[0]] || unique[0] })
      const providerID = sample.providerID
      const existing = new Map(state.configuredModels.map((item) => [`${item.providerID}/${item.modelID}`, item]))
      const others = state.configuredModels.filter((item) => item.providerID !== providerID)
      const nextModels = unique.map((modelID) => {
        const label = modelNames?.[modelID]?.trim() || modelID
        const created = createConfiguredModel({
          ...form,
          providerID,
          providerName: form.providerName.trim() || sample.providerName,
          modelID,
          name: label,
          inputModalities: modelInputs?.[modelID] ?? form.inputModalities ?? existing.get(`${providerID}/${modelID}`)?.inputModalities,
        })
        const prev = existing.get(`${providerID}/${modelID}`)
        return prev ? { ...created, id: prev.id, name: prev.name === prev.modelID ? created.name : prev.name } : created
      })
      try {
        await applyConfiguredModels([...others, ...nextModels], `${providerID}/${unique[0]}`)
        setState("modelSettingsOpen", false)
      } catch (error) {
        setState("modelSettingsError", error instanceof Error ? error.message : "同步到后端失败")
      }
    },
    importConfiguredModels: async (incoming: ConfiguredModel[], mode: ModelConfigImportMode) => {
      setState("modelSettingsError", null)
      const next =
        mode === "merge" ? mergeConfiguredModels(state.configuredModels, incoming) : replaceConfiguredModels(incoming)
      try {
        await applyConfiguredModels(next)
      } catch (error) {
        const message = error instanceof Error ? error.message : "同步到后端失败"
        setState("modelSettingsError", message)
        throw error instanceof Error ? error : new Error(message)
      }
    },
    deleteConfiguredModel: async (id) => {
      try {
        await applyConfiguredModels(state.configuredModels.filter((item) => item.id !== id))
      } catch (error) {
        setState("modelSettingsError", error instanceof Error ? error.message : "删除后同步失败")
      }
    },
    setModelInput: async (id, input) => {
      setState("modelSettingsError", null)
      try {
        await applyConfiguredModels(state.configuredModels.map((model) => model.id === id ? { ...model, inputModalities: parseInputMedia(input) } : model))
        await refreshDiscovered()
      } catch (error) {
        setState("modelSettingsError", error instanceof Error ? error.message : "更新附件能力失败")
      }
    },
    refreshDiscovered,
    setVariant: (value) => {
      rememberSelectedVariant(state.selectedModelKey, value)
      setState({ selectedVariant: value, variantMenuOpen: false })
    },
    openVariantMenu: () => setState(popoverPatch("variant")),
    closeVariantMenu: () => setState("variantMenuOpen", false),
    nameFor: (providerID, modelID) => {
      if (!modelID && !providerID) return ""
      if (providerID && modelID) {
        const key = modelKey(providerID, modelID)
        const named =
          selectableModels().find((item) => item.key === key) ??
          state.discoveredModels.find((item) => item.key === key) ??
          state.configuredModels.find((item) => item.providerID === providerID && item.modelID === modelID)
        if (named && "name" in named && named.name) return named.name
      }
      return modelID || providerID || ""
    },
  }
}
