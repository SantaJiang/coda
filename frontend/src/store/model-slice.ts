import {
  createConfiguredModel,
  discoveredFromProviderList,
  formatVariantLabel,
  mergeSelectables,
  modelKey,
  resolveSelectedKey,
  saveConfiguredModels,
  savePinnedModelKeys,
  saveSelectedModelKey,
  toBackendPatch,
  variantsByKey,
  type ConfiguredModel,
  type ModelForm,
} from "../lib/models"
import { popoverPatch, type AppState } from "./state"
import type { ModelApi } from "./contracts"
import { selectedProjectOf, type StoreHandle } from "./handle"

export function selectableModelsOf(state: AppState) {
  return mergeSelectables(
    state.configuredModels,
    state.discoveredModels.filter((item) => state.pinnedModelKeys.includes(item.key)),
  )
}

export function selectedModelOf(state: AppState) {
  return selectableModelsOf(state).find((item) => item.key === state.selectedModelKey)
}

export function persistSelection(handle: StoreHandle, key: string | null) {
  handle.setState("selectedModelKey", key)
  saveSelectedModelKey(key)
}

export function createModelSlice(handle: StoreHandle): ModelApi {
  const { state, setState, client } = handle

  const selectableModels = () => selectableModelsOf(state)
  const selectedModel = () => selectedModelOf(state)

  const applyConfiguredModels = async (models: ConfiguredModel[], preferredKey?: string | null) => {
    const extras = state.discoveredModels.filter((item) => state.pinnedModelKeys.includes(item.key))
    const selectables = mergeSelectables(models, extras)
    const nextKey = resolveSelectedKey(models, selectables, preferredKey ?? state.selectedModelKey)
    setState("configuredModels", models)
    persistSelection(handle, nextKey)
    saveConfiguredModels(models)
    const patch = toBackendPatch(models, nextKey)
    if (!patch) return
    await client.patchGlobalConfig(patch)
  }

  const refreshDiscovered = async () => {
    try {
      const project = selectedProjectOf(state)
      const list = await client.listProviders(project?.missing ? undefined : project?.path)
      const discovered = discoveredFromProviderList(list)
      setState("discoveredModels", discovered)
      setState("modelVariants", variantsByKey(list))
      const extras = discovered.filter((item) => state.pinnedModelKeys.includes(item.key))
      const nextKey = resolveSelectedKey(
        state.configuredModels,
        mergeSelectables(state.configuredModels, extras),
        state.selectedModelKey,
      )
      persistSelection(handle, nextKey)
    } catch {
      setState("discoveredModels", [])
    }
  }

  return {
    selectableModels,
    selectedModel,
    selectedModelKey: () => state.selectedModelKey,
    selectedVariant: () => state.selectedVariant,
    currentVariants: () => {
      const key = state.selectedModelKey
      if (!key) return []
      return state.modelVariants[key] ?? selectedModel()?.variants ?? []
    },
    variantLabel: () => formatVariantLabel(state.selectedVariant ?? "default"),
    modelMenuOpen: () => state.modelMenuOpen,
    variantMenuOpen: () => state.variantMenuOpen,
    modelSettingsOpen: () => state.modelSettingsOpen,
    modelSettingsError: () => state.modelSettingsError,
    configuredModels: () => state.configuredModels,
    discoveredModels: () => state.discoveredModels,
    isPinned: (key) => state.pinnedModelKeys.includes(key),
    selectModel: (key) => {
      persistSelection(handle, key)
      const variants = state.modelVariants[key] ?? []
      const nextVariant = state.selectedVariant && variants.includes(state.selectedVariant) ? state.selectedVariant : null
      setState({
        ...popoverPatch(null),
        selectedVariant: nextVariant,
      })
    },
    openModelMenu: () => {
      setState(popoverPatch("model"))
      void refreshDiscovered()
    },
    closeModelMenu: () => setState("modelMenuOpen", false),
    openModelSettings: () => setState({ modelMenuOpen: false, modelSettingsOpen: true, modelSettingsError: null }),
    closeModelSettings: () => setState({ modelSettingsOpen: false, modelSettingsError: null }),
    saveConfiguredProvider: async (form: ModelForm, modelIDs: string[]) => {
      setState("modelSettingsError", null)
      const unique = [...new Set(modelIDs.map((item) => item.trim()).filter(Boolean))]
      if (unique.length === 0) {
        setState("modelSettingsError", "请至少勾选一个模型")
        return
      }
      const sample = createConfiguredModel({ ...form, modelID: unique[0], name: unique[0] })
      const providerID = sample.providerID
      const existing = new Map(state.configuredModels.map((item) => [`${item.providerID}/${item.modelID}`, item]))
      const others = state.configuredModels.filter((item) => item.providerID !== providerID)
      const nextModels = unique.map((modelID) => {
        const created = createConfiguredModel({
          ...form,
          providerID,
          providerName: form.providerName.trim() || sample.providerName,
          modelID,
          name: modelID,
        })
        const prev = existing.get(`${providerID}/${modelID}`)
        return prev ? { ...created, id: prev.id, name: prev.name === prev.modelID ? modelID : prev.name } : created
      })
      try {
        await applyConfiguredModels([...others, ...nextModels], `${providerID}/${unique[0]}`)
        setState("modelSettingsOpen", false)
      } catch (error) {
        setState("modelSettingsError", error instanceof Error ? error.message : "同步到后端失败")
      }
    },
    deleteConfiguredModel: async (id) => {
      try {
        await applyConfiguredModels(state.configuredModels.filter((item) => item.id !== id))
      } catch (error) {
        setState("modelSettingsError", error instanceof Error ? error.message : "删除后同步失败")
      }
    },
    pinDiscoveredModel: (key) => {
      if (state.pinnedModelKeys.includes(key)) {
        persistSelection(handle, key)
        return
      }
      const keys = [...state.pinnedModelKeys, key]
      setState("pinnedModelKeys", keys)
      savePinnedModelKeys(keys)
      persistSelection(handle, key)
    },
    unpinDiscoveredModel: (key) => {
      const keys = state.pinnedModelKeys.filter((item) => item !== key)
      setState("pinnedModelKeys", keys)
      savePinnedModelKeys(keys)
      if (state.selectedModelKey === key) {
        persistSelection(handle, resolveSelectedKey(state.configuredModels, selectableModels(), null))
      }
    },
    refreshDiscovered,
    setVariant: (value) => setState({ selectedVariant: value, variantMenuOpen: false }),
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
