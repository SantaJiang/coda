import { For, Show, onCleanup, onMount } from "solid-js"
import { useApp } from "../store/app"

export function ModelMenu() {
  const app = useApp()
  let root: HTMLDivElement | undefined

  const label = () => app.selectedModel()?.name ?? "配置模型"
  const models = () => app.selectableModels()

  onMount(() => {
    const onPointer = (event: PointerEvent) => {
      if (!app.state.modelMenuOpen) return
      const target = event.target as Node | null
      if (root && target && root.contains(target)) return
      app.closeModelMenu()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") app.closeModelMenu()
    }
    document.addEventListener("pointerdown", onPointer)
    document.addEventListener("keydown", onKey)
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointer)
      document.removeEventListener("keydown", onKey)
    })
  })

  const toggle = () => {
    if (app.state.modelMenuOpen) app.closeModelMenu()
    else app.openModelMenu()
  }

  return (
    <div class="model-picker" ref={root}>
      <button
        type="button"
        class="model-chip"
        classList={{ open: app.state.modelMenuOpen, empty: !app.selectedModel() }}
        onClick={toggle}
      >
        {label()}
      </button>
      <Show when={app.state.modelMenuOpen}>
        <div class="model-menu" role="menu">
          <Show when={models().length > 0}>
            <div class="model-menu-list">
              <For each={models()}>
                {(model) => (
                  <button
                    type="button"
                    class="model-menu-item"
                    classList={{ active: model.key === app.state.selectedModelKey }}
                    role="menuitem"
                    onClick={() => app.selectModel(model.key)}
                  >
                    <span class="model-menu-name">{model.name}</span>
                    <Show when={model.source === "opencode"}>
                      <span class="model-menu-tag">已连接</span>
                    </Show>
                  </button>
                )}
              </For>
            </div>
            <div class="model-menu-sep" />
          </Show>
          <button type="button" class="model-menu-item" role="menuitem" onClick={() => app.openModelSettings()}>
            配置模型
          </button>
        </div>
      </Show>
    </div>
  )
}
