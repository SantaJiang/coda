import { For, Show, createEffect, createSignal } from "solid-js"
import {
  emptyModelForm,
  formFromModel,
  slugify,
  validateModelForm,
  type ModelForm,
} from "../lib/models"
import { useApp } from "../store/app"

export function ModelSettings() {
  const app = useApp()
  const [form, setForm] = createSignal<ModelForm>(emptyModelForm())
  const [editingId, setEditingId] = createSignal<string | undefined>()
  const [providerTouched, setProviderTouched] = createSignal(false)
  const [formError, setFormError] = createSignal<string | null>(null)
  const [saving, setSaving] = createSignal(false)
  const [showDiscovered, setShowDiscovered] = createSignal(false)

  const resetForm = () => {
    setForm(emptyModelForm())
    setEditingId(undefined)
    setProviderTouched(false)
    setFormError(null)
  }

  createEffect((wasOpen?: boolean) => {
    const open = app.state.modelSettingsOpen
    if (open && !wasOpen) {
      resetForm()
      void app.refreshDiscovered()
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

  const startEdit = (id: string) => {
    const model = app.state.configuredModels.find((item) => item.id === id)
    if (!model) return
    setForm(formFromModel(model))
    setEditingId(id)
    setProviderTouched(true)
    setFormError(null)
  }

  const submit = async (event: Event) => {
    event.preventDefault()
    const error = validateModelForm(form())
    if (error) {
      setFormError(error)
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await app.saveConfiguredModel(form(), editingId())
      resetForm()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  const onOverlay = (event: MouseEvent) => {
    if (event.target === event.currentTarget) app.closeModelSettings()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") app.closeModelSettings()
  }

  return (
    <Show when={app.state.modelSettingsOpen}>
      <div class="dialog-overlay" onMouseDown={onOverlay} onKeyDown={onKeyDown}>
        <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="model-settings-title">
          <header class="dialog-head">
            <h2 id="model-settings-title">配置模型</h2>
            <button type="button" class="icon-btn" onClick={() => app.closeModelSettings()} aria-label="关闭">
              ✕
            </button>
          </header>

          <p class="dialog-hint">添加 OpenAI 兼容接口。Coda 负责选用哪些模型，OpenCode 负责实际调用。</p>

          <section class="model-list">
            <div class="model-list-title">已添加</div>
            <Show
              when={app.state.configuredModels.length > 0}
              fallback={<div class="model-list-empty">还没有配置任何模型</div>}
            >
              <For each={app.state.configuredModels}>
                {(model) => (
                  <div class="model-row" classList={{ editing: editingId() === model.id }}>
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
                      <button type="button" class="text-btn danger" onClick={() => void app.deleteConfiguredModel(model.id)}>
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
              OpenCode 已连接（{app.state.discoveredModels.length}）
            </button>
            <Show when={showDiscovered()}>
              <Show
                when={app.state.discoveredModels.length > 0}
                fallback={<div class="model-list-empty">当前没有已连接的供应商</div>}
              >
                <div class="discovered-scroll">
                  <For each={app.state.discoveredModels}>
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
                            app.state.pinnedModelKeys.includes(model.key)
                              ? app.unpinDiscoveredModel(model.key)
                              : app.pinDiscoveredModel(model.key)
                          }
                        >
                          {app.state.pinnedModelKeys.includes(model.key) ? "移出菜单" : "加入菜单"}
                        </button>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </section>

          <form class="model-form" onSubmit={submit}>
            <div class="model-form-title">{editingId() ? "编辑模型" : "添加模型"}</div>
            <label class="field">
              <span>显示名称</span>
              <input
                value={form().name}
                placeholder="我的模型"
                onInput={(event) => update("name", event.currentTarget.value)}
              />
            </label>
            <label class="field">
              <span>模型 ID</span>
              <input
                value={form().modelID}
                placeholder="gpt-4o"
                onInput={(event) => update("modelID", event.currentTarget.value)}
              />
            </label>
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
                placeholder="sk-..."
                autocomplete="off"
                onInput={(event) => update("apiKey", event.currentTarget.value)}
              />
            </label>
            <label class="field">
              <span>供应商 ID</span>
              <input
                value={form().providerID}
                placeholder="openai"
                onInput={(event) => {
                  setProviderTouched(true)
                  update("providerID", event.currentTarget.value)
                }}
              />
            </label>
            <p class="field-note">同一接口下的多个模型请使用相同供应商 ID。接口地址需包含 /v1。</p>
            <Show when={formError() || app.state.modelSettingsError}>
              <div class="dialog-error">{formError() || app.state.modelSettingsError}</div>
            </Show>
            <div class="dialog-actions">
              <Show when={editingId()}>
                <button type="button" class="ghost-btn" onClick={resetForm}>
                  取消编辑
                </button>
              </Show>
              <button type="submit" class="send-btn" disabled={saving()}>
                {saving() ? "保存中…" : "保存"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Show>
  )
}
