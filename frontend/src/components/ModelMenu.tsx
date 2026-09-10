import { For, Show } from "solid-js"
import { useDismissable } from "../lib/dismiss"
import { useModels } from "../store/app"

export function ModelMenu() {
  const app = useModels()
  let root: HTMLDivElement | undefined

  const label = () => app.selectedModel()?.name ?? "配置模型"
  const models = () => app.selectableModels()

  useDismissable({
    active: () => app.modelMenuOpen(),
    onClose: () => app.closeModelMenu(),
    root: () => root,
  })

  const toggle = () => {
    if (app.modelMenuOpen()) app.closeModelMenu()
    else app.openModelMenu()
  }

  return (
    <div class="model-picker" ref={root}>
      <button
        type="button"
        class="model-chip"
        classList={{ open: app.modelMenuOpen(), empty: !app.selectedModel() }}
        onClick={toggle}
      >
        {label()}
      </button>
      <Show when={app.modelMenuOpen()}>
        <div class="model-menu" role="menu">
          <Show when={models().length > 0}>
            <div class="model-menu-list">
              <For each={models()}>
                {(model) => (
                  <button
                    type="button"
                    class="model-menu-item"
                    classList={{ active: model.key === app.selectedModelKey() }}
                    role="menuitem"
                    onClick={() => app.selectModel(model.key)}
                  >
                    <span class="model-menu-name">{model.name}</span>
                    <Show when={model.source === "discovered"}>
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
