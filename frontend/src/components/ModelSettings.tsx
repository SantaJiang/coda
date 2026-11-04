import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"
import {
  MODEL_CONFIG_FILENAME,
  parseModelConfigFile,
  serializeModelConfig,
  type ModelConfigImportMode,
} from "../lib/model-config-file"
import {
  emptyModelForm,
  validateFetchForm,
  validateProviderForm,
  type ConfiguredModel,
  type ModelForm,
} from "../lib/models"
import { openTextFile, saveTextFile } from "../lib/persist"
import { normalizeProviderBaseURL } from "../lib/presets"
import { parseImportedProviders, type ImportedProvider } from "../lib/provider-import"
import { listRemoteModels, type RemoteModel } from "../lib/remote-models"
import { modelCatalog, type CatalogProvider } from "../lib/catalog"
import { useModels } from "../store/app"
import { Icon } from "./Icon"
import { INPUT_MEDIA, INPUT_LABELS, type InputMedia } from "../lib/model-input"

type Tab = "mine" | "catalog" | "custom"

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "mine", label: "我的模型" },
  { id: "catalog", label: "目录" },
  { id: "custom", label: "自定义" },
]

export function ModelSettings() {
  const models = useModels()
  const [tab, setTab] = createSignal<Tab>("mine")
  const [form, setForm] = createSignal<ModelForm>(emptyModelForm())
  const [formError, setFormError] = createSignal<string | null>(null)
  const [saving, setSaving] = createSignal(false)
  const [loadingModels, setLoadingModels] = createSignal(false)
  const [remoteModels, setRemoteModels] = createSignal<RemoteModel[]>([])
  const [importedInputs, setImportedInputs] = createSignal<Record<string, InputMedia[]>>({})
  const [checked, setChecked] = createSignal<string[]>([])
  const [customModelID, setCustomModelID] = createSignal("")
  const [importText, setImportText] = createSignal("")
  const [importing, setImporting] = createSignal(false)
  const [fileBusy, setFileBusy] = createSignal(false)
  const [fileStatus, setFileStatus] = createSignal<string | null>(null)
  const [pendingImport, setPendingImport] = createSignal<ConfiguredModel[] | null>(null)
  let fetchGen = 0
  let providerNameInput: HTMLInputElement | undefined
  let baseURLInput: HTMLInputElement | undefined
  let apiKeyInput: HTMLInputElement | undefined
  let composingField = false

  const invalidateFetch = () => {
    fetchGen += 1
    setLoadingModels(false)
  }

  const resetForm = () => {
    invalidateFetch()
    setForm(emptyModelForm())
    setImportedInputs({})
    setFormError(null)
    setRemoteModels([])
    setChecked([])
    setCustomModelID("")
    setImportText("")
    setFileStatus(null)
    setPendingImport(null)
  }

  createEffect((wasOpen?: boolean) => {
    const open = models.modelSettingsOpen()
    if (open && !wasOpen) {
      resetForm()
      setTab("mine")
    }
    if (!open) setPendingImport(null)
    return open
  })

  const update = <K extends keyof ModelForm>(key: K, value: ModelForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const startEdit = (id: string) => {
    setImportedInputs({})
    invalidateFetch()
    const model = models.configuredModels().find((item) => item.id === id)
    if (!model) return
    const siblings = models.configuredModels().filter((item) => item.providerID === model.providerID)
    setForm({
      name: model.providerName || model.providerID,
      providerID: model.providerID,
      providerName: model.providerName,
      modelID: "",
      baseURL: model.baseURL,
      apiKey: model.apiKey,
    })
    setFormError(null)
    setRemoteModels(siblings.map((item) => ({ id: item.modelID, name: item.name })))
    setChecked(siblings.map((item) => item.modelID))
    setCustomModelID("")
    setTab("custom")
  }

  const toggleChecked = (id: string) => {
    setChecked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  const applyImported = (imported: ImportedProvider) => {
    invalidateFetch()
    const baseURL = normalizeProviderBaseURL(imported.form.baseURL, imported.form.providerID)
    setForm({ ...imported.form, baseURL })
    setRemoteModels(imported.models)
    setImportedInputs(Object.fromEntries(imported.models.filter((model) => model.inputModalities).map((model) => [model.id, model.inputModalities!])))
    setChecked(imported.models.map((item) => item.id))
    setFormError(null)
    setTab("custom")
  }

  const namesFor = (ids: string[]) => {
    const names: Record<string, string> = {}
    for (const model of remoteModels()) {
      if (ids.includes(model.id) && model.name.trim()) names[model.id] = model.name.trim()
    }
    return names
  }

  const fetchModels = async () => {
    const gen = ++fetchGen
    const current = form()
    const baseURL = normalizeProviderBaseURL(current.baseURL, current.providerID)
    if (baseURL !== current.baseURL) setForm({ ...current, baseURL })
    const error = validateFetchForm({ ...current, baseURL })
    if (error) {
      setFormError(error)
      return
    }
    setLoadingModels(true)
    setFormError(null)
    try {
      const list = await listRemoteModels(baseURL, current.apiKey)
      if (gen !== fetchGen) return
      const named = new Map(remoteModels().map((item) => [item.id, item.name]))
      const extra = checked().filter((id) => !list.some((item) => item.id === id))
      setRemoteModels([
        ...list.map((item) => {
          const previous = named.get(item.id)
          const name = previous && previous !== item.id ? previous : item.name || previous || item.id
          return { ...item, name }
        }),
        ...extra.map((id) => ({ id, name: named.get(id) || id })),
      ])
    } catch (err) {
      if (gen !== fetchGen) return
      setFormError(err instanceof Error ? err.message : "获取模型列表失败")
    } finally {
      if (gen === fetchGen) setLoadingModels(false)
    }
  }

  const addCustomModel = () => {
    const id = customModelID().trim()
    if (!id) return
    setRemoteModels((current) => (current.some((item) => item.id === id) ? current : [...current, { id, name: id }]))
    setChecked((current) => (current.includes(id) ? current : [...current, id]))
    setCustomModelID("")
  }

  const importProviders = async () => {
    setImporting(true)
    setFormError(null)
    try {
      const imported = parseImportedProviders(importText())
      if (imported.length === 1) {
        applyImported(imported[0])
        return
      }
      for (const item of imported) {
        const ids = item.models.map((model) => model.id)
        const names: Record<string, string> = {}
        for (const model of item.models) names[model.id] = model.name
        await models.saveConfiguredProvider(
          { ...item.form, baseURL: normalizeProviderBaseURL(item.form.baseURL, item.form.providerID) },
          ids,
          names,
          Object.fromEntries(item.models.filter((model) => model.inputModalities).map((model) => [model.id, model.inputModalities!])),
        )
      }
      resetForm()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "解析 JSON 失败")
    } finally {
      setImporting(false)
    }
  }

  const submit = async (event: Event) => {
    event.preventDefault()
    const current = form()
    const next = {
      ...current,
      baseURL: normalizeProviderBaseURL(current.baseURL, current.providerID),
    }
    if (next.baseURL !== current.baseURL) setForm(next)
    const error = validateProviderForm(next)
    if (error) {
      setFormError(error)
      return
    }
    const selected = checked()
    if (selected.length === 0) {
      setFormError("请先获取并勾选要加入菜单的模型")
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await models.saveConfiguredProvider(next, selected, namesFor(selected), importedInputs())
      resetForm()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  const applyImport = async (incoming: ConfiguredModel[], mode: ModelConfigImportMode) => {
    setFileBusy(true)
    setFormError(null)
    try {
      await models.importConfiguredModels(incoming, mode)
      setPendingImport(null)
      setFileStatus(mode === "merge" ? "已合并导入" : "已导入")
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "导入失败")
    } finally {
      setFileBusy(false)
    }
  }

  const importConfig = async () => {
    if (fileBusy() || pendingImport()) return
    setFormError(null)
    setFileStatus(null)
    setFileBusy(true)
    try {
      const raw = await openTextFile()
      if (raw == null) return
      const incoming = parseModelConfigFile(raw)
      if (models.configuredModels().length === 0) {
        await applyImport(incoming, "replace")
        return
      }
      setPendingImport(incoming)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "导入失败")
    } finally {
      setFileBusy(false)
    }
  }

  const exportConfig = async () => {
    if (fileBusy() || pendingImport()) return
    const list = models.configuredModels()
    if (!list.length) return
    setFormError(null)
    setFileStatus(null)
    setFileBusy(true)
    try {
      const saved = await saveTextFile(MODEL_CONFIG_FILENAME, serializeModelConfig(list))
      if (saved) setFileStatus("已导出（含明文 API Key）")
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "导出失败")
    } finally {
      setFileBusy(false)
    }
  }

  const onOverlay = (event: MouseEvent) => {
    if (pendingImport()) return
    if (event.target === event.currentTarget) models.closeModelSettings()
  }

  createEffect(() => {
    if (!models.modelSettingsOpen()) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return
      event.preventDefault()
      event.stopPropagation()
      if (pendingImport()) {
        if (!fileBusy()) setPendingImport(null)
        return
      }
      models.closeModelSettings()
    }
    document.addEventListener("keydown", onKey, true)
    onCleanup(() => document.removeEventListener("keydown", onKey, true))
  })

  createEffect(() => {
    const current = form()
    if (composingField) return
    if (providerNameInput && providerNameInput.value !== current.providerName) providerNameInput.value = current.providerName
    if (baseURLInput && baseURLInput.value !== current.baseURL) baseURLInput.value = current.baseURL
    if (apiKeyInput && apiKeyInput.value !== current.apiKey) apiKeyInput.value = current.apiKey
  })

  const inputEnabled = (model: ConfiguredModel, type: InputMedia) =>
    model.inputModalities?.includes(type) ??
    models.selectableModels().find((item) => item.key === `${model.providerID}/${model.modelID}`)?.input?.[type] ??
    false

  const toggleInput = (model: ConfiguredModel, type: InputMedia) => {
    const next = INPUT_MEDIA.filter((item) => (item === type ? !inputEnabled(model, type) : inputEnabled(model, item)))
    void models.setModelInput(model.id, next)
  }

  return (
    <Show when={models.modelSettingsOpen()}>
      <>
      <div class="dialog-overlay" onMouseDown={onOverlay}>
        <div
          class="dialog model-settings-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="model-settings-title"
        >
          <header class="dialog-head">
            <h2 id="model-settings-title">配置模型</h2>
            <button type="button" class="icon-btn" onClick={() => models.closeModelSettings()} aria-label="关闭">
              <Icon name="times" />
            </button>
          </header>

          <div class="settings-tabs" role="tablist">
            <For each={TABS}>
              {(item) => (
                <button
                  type="button"
                  role="tab"
                  class="settings-tab"
                  classList={{ active: tab() === item.id }}
                  aria-selected={tab() === item.id}
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                </button>
              )}
            </For>
          </div>

          <Show when={tab() === "mine"}>
            <section class="model-list settings-pane">
              <div class="model-list-head">
                <div class="model-list-title">已添加 {models.configuredModels().length || ""}</div>
                <div class="model-list-file-actions">
                  <button type="button" class="text-btn" disabled={fileBusy()} onClick={() => void importConfig()}>
                    导入
                  </button>
                  <button
                    type="button"
                    class="text-btn"
                    disabled={fileBusy() || models.configuredModels().length === 0}
                    onClick={() => void exportConfig()}
                  >
                    导出
                  </button>
                </div>
              </div>
              <Show when={fileStatus()}>
                <div class="field-hint">{fileStatus()}</div>
              </Show>
              <Show
                when={models.configuredModels().length > 0}
                fallback={<div class="model-list-empty">还没有配置任何模型，从目录或自定义接口开始</div>}
              >
                <For each={models.configuredModels()}>
                  {(model) => (
                    <div class="model-row">
                      <div class="model-row-main">
                        <div class="model-row-name">{model.name}</div>
                        <div class="model-row-meta">
                          {model.providerName || model.providerID} / {model.modelID}
                        </div>
                        <div class="capability-pills">
                          <For each={INPUT_MEDIA}>
                            {(type) => (
                              <button
                                type="button"
                                class="capability-pill"
                                classList={{ on: inputEnabled(model, type) }}
                                disabled={type === "video"}
                                aria-pressed={inputEnabled(model, type)}
                                title={`切换${INPUT_LABELS[type]}输入`}
                                onClick={() => toggleInput(model, type)}
                              >
                                {INPUT_LABELS[type]}
                              </button>
                            )}
                          </For>
                        </div>
                      </div>
                      <div class="model-row-actions">
                        <button type="button" class="text-btn" onClick={() => startEdit(model.id)}>
                          编辑
                        </button>
                        <button type="button" class="text-btn danger" onClick={() => void models.deleteConfiguredModel(model.id)}>
                          删除
                        </button>
                      </div>
                    </div>
                  )}
                </For>
              </Show>
            </section>
          </Show>

          <Show when={tab() === "catalog"}>
            <CatalogPane models={models} />
          </Show>
          <Show when={tab() === "custom"}>
            <form class="model-form settings-pane" onSubmit={submit}>
              <label class="field">
                <span>接口名称</span>
                <input
                  ref={(element) => {
                    providerNameInput = element
                    element.value = form().providerName
                  }}
                  placeholder="例如 我的代理"
                  onCompositionStart={() => {
                    composingField = true
                  }}
                  onCompositionEnd={(event) => {
                    composingField = false
                    const value = event.currentTarget.value
                    setForm((current) => ({ ...current, providerName: value, name: value }))
                  }}
                  onInput={(event) => {
                    const value = event.currentTarget.value
                    setForm((current) => ({ ...current, providerName: value, name: value }))
                  }}
                />
              </label>
              <label class="field">
                <span>接口地址</span>
                <input
                  ref={(element) => {
                    baseURLInput = element
                    element.value = form().baseURL
                  }}
                  placeholder="https://api.openai.com/v1"
                  onCompositionStart={() => {
                    composingField = true
                  }}
                  onCompositionEnd={(event) => {
                    composingField = false
                    update("baseURL", event.currentTarget.value)
                  }}
                  onInput={(event) => update("baseURL", event.currentTarget.value)}
                />
              </label>
              <label class="field">
                <span>API Key</span>
                <input
                  type="password"
                  ref={(element) => {
                    apiKeyInput = element
                    element.value = form().apiKey
                  }}
                  placeholder="sk-..."
                  autocomplete="off"
                  onCompositionStart={() => {
                    composingField = true
                  }}
                  onCompositionEnd={(event) => {
                    composingField = false
                    update("apiKey", event.currentTarget.value)
                  }}
                  onInput={(event) => update("apiKey", event.currentTarget.value)}
                />
              </label>
              <div class="dialog-actions split">
                <button type="button" class="ghost-btn" disabled={loadingModels()} onClick={() => void fetchModels()}>
                  {loadingModels() ? "获取中…" : "获取模型列表"}
                </button>
              </div>
              <Show when={remoteModels().length > 0}>
                <div class="model-pick-head">
                  <span>勾选要加入菜单的模型（{checked().length}）</span>
                  <button
                    type="button"
                    class="text-btn"
                    onClick={() =>
                      setChecked(
                        checked().length === remoteModels().length ? [] : remoteModels().map((item) => item.id),
                      )
                    }
                  >
                    {checked().length === remoteModels().length ? "取消全选" : "全选"}
                  </button>
                </div>
                <div class="model-pick-list">
                  <For each={remoteModels()}>
                    {(model) => (
                      <label class="model-pick-item">
                        <input
                          type="checkbox"
                          checked={checked().includes(model.id)}
                          onChange={() => toggleChecked(model.id)}
                        />
                        <span class="truncate">{model.name}</span>
                      </label>
                    )}
                  </For>
                </div>
              </Show>
              <label class="field">
                <span>手动添加模型 ID</span>
                <div class="field-row">
                  <input
                    value={customModelID()}
                    placeholder="接口未列出时填写"
                    onInput={(event) => setCustomModelID(event.currentTarget.value)}
                  />
                  <button type="button" class="ghost-btn" onClick={addCustomModel}>
                    加入
                  </button>
                </div>
              </label>
              <details class="import-json">
                <summary>粘贴供应商 JSON</summary>
                <textarea
                  value={importText()}
                  rows={6}
                  placeholder={'例如 "namo_hw": { "options": { "baseURL": "https://.../v1" }, "models": { "model-id": { "name": "显示名" } } }'}
                  onInput={(event) => setImportText(event.currentTarget.value)}
                />
                <div class="dialog-actions split">
                  <button type="button" class="ghost-btn" disabled={importing() || !importText().trim()} onClick={() => void importProviders()}>
                    {importing() ? "解析中…" : "填入表单"}
                  </button>
                </div>
              </details>
              <Show when={formError() || models.modelSettingsError()}>
                <div class="dialog-error">{formError() || models.modelSettingsError()}</div>
              </Show>
              <div class="dialog-actions">
                <button type="submit" class="send-btn" disabled={saving()}>
                  {saving() ? "保存中…" : "保存到菜单"}
                </button>
              </div>
            </form>
          </Show>
        </div>
      </div>
      <Show when={pendingImport()}>
        {(incoming) => (
          <div
            class="dialog-overlay nested"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !fileBusy()) setPendingImport(null)
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !fileBusy()) setPendingImport(null)
            }}
          >
            <div class="dialog confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="model-import-title">
              <header class="dialog-head">
                <h2 id="model-import-title">本机已有模型配置</h2>
                <button
                  type="button"
                  class="icon-btn"
                  aria-label="关闭"
                  disabled={fileBusy()}
                  onClick={() => setPendingImport(null)}
                >
                  <Icon name="times" />
                </button>
              </header>
              <p class="dialog-hint">
                导入 {incoming().length} 个模型。相同接口地址和 API Key 只会保留一份，并按模型 ID
                去重。请选择覆盖本机配置，还是与当前配置合并。
              </p>
              <Show when={formError() || models.modelSettingsError()}>
                <div class="dialog-error">{formError() || models.modelSettingsError()}</div>
              </Show>
              <div class="dialog-actions">
                <button type="button" class="ghost-btn" autofocus disabled={fileBusy()} onClick={() => setPendingImport(null)}>
                  取消
                </button>
                <button
                  type="button"
                  class="send-btn stop"
                  disabled={fileBusy()}
                  onClick={() => void applyImport(incoming(), "replace")}
                >
                  覆盖
                </button>
                <button
                  type="button"
                  class="send-btn"
                  disabled={fileBusy()}
                  onClick={() => void applyImport(incoming(), "merge")}
                >
                  {fileBusy() ? "导入中…" : "合并"}
                </button>
              </div>
            </div>
          </div>
        )}
      </Show>
      </>
    </Show>
  )
}

const MODEL_LIST_LIMIT = 200

function CatalogPane(props: { models: ReturnType<typeof useModels> }) {
  const [providers, setProviders] = createSignal<CatalogProvider[] | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [query, setQuery] = createSignal("")
  const [expanded, setExpanded] = createSignal<string | null>(null)
  const [selection, setSelection] = createSignal<{ providerID: string; ids: string[] } | null>(null)
  const [apiKey, setApiKey] = createSignal("")
  const [busy, setBusy] = createSignal(false)

  const load = () => {
    modelCatalog()
      .then(setProviders)
      .catch((err) => setError(err instanceof Error ? err.message : "目录加载失败"))
  }

  createEffect(() => {
    if (providers() === null && error() === null) load()
  })

  const retry = () => {
    setError(null)
    setProviders(null)
  }

  const searching = () => query().trim().length > 0
  const filteredProviders = () => {
    const list = providers()
    if (!list) return []
    const q = query().trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (provider) =>
        provider.name.toLowerCase().includes(q) ||
        provider.id.toLowerCase().includes(q) ||
        provider.models.some((model) => model.name.toLowerCase().includes(q) || model.id.toLowerCase().includes(q)),
    )
  }

  const providerModels = (provider: CatalogProvider) => {
    const q = query().trim().toLowerCase()
    const models = q
      ? provider.models.filter((model) => model.name.toLowerCase().includes(q) || model.id.toLowerCase().includes(q))
      : provider.models
    return models.slice(0, MODEL_LIST_LIMIT)
  }

  const isOpen = (providerID: string) => (searching() ? true : expanded() === providerID)
  const toggleOpen = (providerID: string) => setExpanded(expanded() === providerID ? null : providerID)

  const isAdded = (providerID: string, modelID: string) =>
    props.models.configuredModels().some((item) => item.providerID === providerID && item.modelID === modelID)

  const selectedProvider = () => {
    const current = selection()
    return current ? providers()?.find((provider) => provider.id === current.providerID) : undefined
  }

  const toggleModel = (provider: CatalogProvider, modelID: string) => {
    setSelection((current) => {
      if (!current || current.providerID !== provider.id) return { providerID: provider.id, ids: [modelID] }
      const ids = current.ids.includes(modelID)
        ? current.ids.filter((item) => item !== modelID)
        : [...current.ids, modelID]
      return ids.length ? { ...current, ids } : null
    })
  }

  const save = async () => {
    const current = selection()
    const provider = selectedProvider()
    if (!current || !provider) return
    const chosen = provider.models.filter((model) => current.ids.includes(model.id))
    if (!chosen.length) return
    setBusy(true)
    setError(null)
    await props.models.saveConfiguredProvider(
      {
        name: provider.name,
        providerID: provider.id,
        providerName: provider.name,
        modelID: chosen[0].id,
        baseURL: chosen[0].baseURL,
        apiKey: apiKey().trim(),
      },
      current.ids,
      Object.fromEntries(chosen.map((model) => [model.id, model.name])),
      Object.fromEntries(chosen.map((model) => [model.id, model.input])),
    )
    setBusy(false)
  }

  const keyPlaceholder = () => selectedProvider()?.env ?? "API Key"

  return (
    <section class="catalog-pane settings-pane">
      <input
        class="catalog-search"
        type="search"
        placeholder="搜索供应商或模型"
        value={query()}
        onInput={(event) => setQuery(event.currentTarget.value)}
      />
      <Show when={error()}>
        <div class="dialog-error">
          {error()}
          <button type="button" class="text-btn" onClick={retry}>
            重试
          </button>
        </div>
      </Show>
      <Show when={props.models.modelSettingsError()}>
        <div class="dialog-error">{props.models.modelSettingsError()}</div>
      </Show>
      <Show when={!providers() && !error()}>
        <div class="catalog-status">目录加载中…</div>
      </Show>
      <div class="catalog-list">
        <For each={filteredProviders()}>
          {(provider) => (
            <div class="catalog-provider" classList={{ open: isOpen(provider.id) }}>
              <button type="button" class="catalog-provider-head" onClick={() => toggleOpen(provider.id)}>
                <span class="catalog-provider-name">{provider.name}</span>
                <span class="catalog-provider-meta">
                  {provider.models.length} 个模型{provider.env ? ` · ${provider.env}` : ""}
                </span>
                <Icon name="chevron-right" class="catalog-provider-caret" />
              </button>
              <Show when={isOpen(provider.id)}>
                <For each={providerModels(provider)}>
                  {(model) => (
                    <label class="catalog-model" classList={{ added: isAdded(provider.id, model.id) }}>
                      <input
                        type="checkbox"
                        checked={selection()?.providerID === provider.id && selection()!.ids.includes(model.id)}
                        onChange={() => toggleModel(provider, model.id)}
                      />
                      <span class="catalog-model-name">{model.name}</span>
                      <span class="catalog-model-id">{model.id}</span>
                      <span class="capability-pills">
                        <For each={model.input}>{(type) => <span class="capability-pill on">{INPUT_LABELS[type]}</span>}</For>
                        <Show when={isAdded(provider.id, model.id)}>
                          <span class="capability-pill added">已添加</span>
                        </Show>
                      </span>
                    </label>
                  )}
                </For>
              </Show>
            </div>
          )}
        </For>
      </div>
      <Show when={selection()}>
        <div class="catalog-add-bar">
          <input
            type="password"
            placeholder={keyPlaceholder()}
            autocomplete="off"
            value={apiKey()}
            onInput={(event) => setApiKey(event.currentTarget.value)}
          />
          <button
            type="button"
            class="send-btn"
            disabled={busy() || !apiKey().trim()}
            onClick={() => void save()}
          >
            {busy() ? "添加中…" : `添加 ${selection()!.ids.length} 个模型`}
          </button>
        </div>
      </Show>
    </section>
  )
}
