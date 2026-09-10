import { For, Show, createEffect, createSignal } from "solid-js"
import {
  emptyModelForm,
  slugify,
  validateProviderForm,
  type ModelForm,
} from "../lib/models"
import { CUSTOM_PRESET_ID, PROVIDER_PRESETS, presetByBaseURL, presetById } from "../lib/presets"
import { listRemoteModels, type RemoteModel } from "../lib/remote-models"
import { useModels } from "../store/app"
import { Icon } from "./Icon"

export function ModelSettings() {
  const models = useModels()
  const [form, setForm] = createSignal<ModelForm>(emptyModelForm())
  const [presetId, setPresetId] = createSignal<string>(CUSTOM_PRESET_ID)
  const [providerTouched, setProviderTouched] = createSignal(false)
  const [formError, setFormError] = createSignal<string | null>(null)
  const [saving, setSaving] = createSignal(false)
  const [loadingModels, setLoadingModels] = createSignal(false)
  const [remoteModels, setRemoteModels] = createSignal<RemoteModel[]>([])
  const [checked, setChecked] = createSignal<string[]>([])
  const [customModelID, setCustomModelID] = createSignal("")
  const [showDiscovered, setShowDiscovered] = createSignal(false)

  const resetForm = () => {
    setForm(emptyModelForm())
    setPresetId(CUSTOM_PRESET_ID)
    setProviderTouched(false)
    setFormError(null)
    setRemoteModels([])
    setChecked([])
    setCustomModelID("")
  }

  createEffect((wasOpen?: boolean) => {
    const open = models.modelSettingsOpen()
    if (open && !wasOpen) {
      resetForm()
      void models.refreshDiscovered()
    }
    return open
  })

  const update = <K extends keyof ModelForm>(key: K, value: ModelForm[K]) => {
    setForm((current) => {
      const next = { ...current, [key]: value }
      if (!providerTouched() && (key === "name" || key === "providerName")) {
        next.providerID = slugify(next.providerName || next.name)
      }
      return next
    })
  }

  const applyPreset = (id: string) => {
    setPresetId(id)
    setRemoteModels([])
    setChecked([])
    setCustomModelID("")
    setFormError(null)
    if (id === CUSTOM_PRESET_ID) {
      setProviderTouched(false)
      setForm({
        ...emptyModelForm(),
        apiKey: form().apiKey,
      })
      return
    }
    const preset = presetById(id)
    if (!preset) return
    setProviderTouched(true)
    setForm({
      name: preset.name,
      providerID: preset.id,
      providerName: preset.name,
      modelID: "",
      baseURL: preset.baseURL,
      apiKey: form().apiKey,
    })
  }

  const startEdit = (id: string) => {
    const model = models.configuredModels().find((item) => item.id === id)
    if (!model) return
    const siblings = models.configuredModels().filter((item) => item.providerID === model.providerID)
    const matched = presetById(model.providerID) || presetByBaseURL(model.baseURL)
    setPresetId(matched?.id ?? CUSTOM_PRESET_ID)
    setForm({
      name: matched?.name || model.providerName || model.providerID,
      providerID: model.providerID,
      providerName: model.providerName,
      modelID: "",
      baseURL: model.baseURL,
      apiKey: model.apiKey,
    })
    setProviderTouched(true)
    setFormError(null)
    setRemoteModels(siblings.map((item) => ({ id: item.modelID, name: item.name })))
    setChecked(siblings.map((item) => item.modelID))
    setCustomModelID("")
  }

  const toggleChecked = (id: string) => {
    setChecked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  const fetchModels = async () => {
    const error = validateProviderForm(form())
    if (error) {
      setFormError(error)
      return
    }
    setLoadingModels(true)
    setFormError(null)
    try {
      const list = await listRemoteModels(form().baseURL, form().apiKey)
      const extra = checked().filter((id) => !list.some((item) => item.id === id))
      setRemoteModels([...list, ...extra.map((id) => ({ id, name: id }))])
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "获取模型列表失败")
    } finally {
      setLoadingModels(false)
    }
  }

  const addCustomModel = () => {
    const id = customModelID().trim()
    if (!id) return
    setRemoteModels((current) => (current.some((item) => item.id === id) ? current : [...current, { id, name: id }]))
    setChecked((current) => (current.includes(id) ? current : [...current, id]))
    setCustomModelID("")
  }

  const submit = async (event: Event) => {
    event.preventDefault()
    const error = validateProviderForm(form())
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
      await models.saveConfiguredProvider(form(), selected)
      resetForm()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  const onOverlay = (event: MouseEvent) => {
    if (event.target === event.currentTarget) models.closeModelSettings()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") models.closeModelSettings()
  }

  const keyPlaceholder = () => presetById(presetId())?.keyPlaceholder ?? "sk-..."

  return (
    <Show when={models.modelSettingsOpen()}>
      <div class="dialog-overlay" onMouseDown={onOverlay} onKeyDown={onKeyDown}>
        <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="model-settings-title">
          <header class="dialog-head">
            <h2 id="model-settings-title">配置模型</h2>
            <button type="button" class="icon-btn" onClick={() => models.closeModelSettings()} aria-label="关闭">
              <Icon name="times" />
            </button>
          </header>

          <p class="dialog-hint">选择厂商，填入 API Key，拉取可用模型后勾选加入输入框菜单。密钥只保存在本机。</p>

          <section class="model-list">
            <div class="model-list-title">已添加</div>
            <Show
              when={models.configuredModels().length > 0}
              fallback={<div class="model-list-empty">还没有配置任何模型</div>}
            >
              <For each={models.configuredModels()}>
                {(model) => (
                  <div class="model-row">
                    <div class="model-row-main">
                      <div class="model-row-name">{model.name}</div>
                      <div class="model-row-meta">
                        {model.providerID} / {model.modelID}
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

          <section class="model-list discovered">
            <button type="button" class="model-list-toggle" onClick={() => setShowDiscovered((open) => !open)}>
              已连接（{models.discoveredModels().length}）
            </button>
            <Show when={showDiscovered()}>
              <Show
                when={models.discoveredModels().length > 0}
                fallback={<div class="model-list-empty">当前没有已连接的供应商</div>}
              >
                <div class="discovered-scroll">
                  <For each={models.discoveredModels()}>
                    {(model) => (
                      <div class="model-row compact">
                        <div class="model-row-main">
                          <div class="model-row-name">{model.name}</div>
                          <div class="model-row-meta">{model.key}</div>
                        </div>
                        <button
                          type="button"
                          class="text-btn"
                          onClick={() =>
                            models.isPinned(model.key)
                              ? models.unpinDiscoveredModel(model.key)
                              : models.pinDiscoveredModel(model.key)
                          }
                        >
                          {models.isPinned(model.key) ? "移出菜单" : "加入菜单"}
                        </button>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </section>

          <form class="model-form" onSubmit={submit}>
            <div class="model-form-title">添加接口</div>
            <div class="preset-row">
              <For each={PROVIDER_PRESETS}>
                {(preset) => (
                  <button
                    type="button"
                    class="preset-chip"
                    classList={{ active: presetId() === preset.id }}
                    onClick={() => applyPreset(preset.id)}
                  >
                    {preset.name}
                  </button>
                )}
              </For>
              <button
                type="button"
                class="preset-chip"
                classList={{ active: presetId() === CUSTOM_PRESET_ID }}
                onClick={() => applyPreset(CUSTOM_PRESET_ID)}
              >
                自定义
              </button>
            </div>
            <label class="field">
              <span>接口地址</span>
              <input
                value={form().baseURL}
                placeholder="https://api.openai.com/v1"
                onInput={(event) => update("baseURL", event.currentTarget.value)}
              />
            </label>
            <label class="field">
              <span>API Key</span>
              <input
                type="password"
                value={form().apiKey}
                placeholder={keyPlaceholder()}
                autocomplete="off"
                onInput={(event) => update("apiKey", event.currentTarget.value)}
              />
            </label>
            <Show when={presetId() === CUSTOM_PRESET_ID}>
              <label class="field">
                <span>供应商 ID</span>
                <input
                  value={form().providerID}
                  placeholder="my-provider"
                  onInput={(event) => {
                    setProviderTouched(true)
                    update("providerID", event.currentTarget.value)
                    update("providerName", event.currentTarget.value)
                  }}
                />
              </label>
            </Show>
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
                  placeholder="可选，接口未列出时手动填写"
                  onInput={(event) => setCustomModelID(event.currentTarget.value)}
                />
                <button type="button" class="ghost-btn" onClick={addCustomModel}>
                  加入
                </button>
              </div>
            </label>
            <Show when={formError() || models.modelSettingsError()}>
              <div class="dialog-error">{formError() || models.modelSettingsError()}</div>
            </Show>
            <div class="dialog-actions">
              <button type="submit" class="send-btn" disabled={saving()}>
                {saving() ? "保存中…" : "保存到菜单"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Show>
  )
}
