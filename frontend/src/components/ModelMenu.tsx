import { For, Show } from "solid-js"
import { useDismissable } from "../lib/dismiss"
import type { SelectableModel } from "../lib/models"
import { useModels } from "../store/app"

function ModelMenuRow(props: { model: SelectableModel; active: boolean; free?: boolean; onSelect: (key: string) => void }) {
  return (
    <button
      type="button"
      class="model-menu-item"
      classList={{ active: props.active }}
      role="menuitem"
      onClick={() => props.onSelect(props.model.key)}
    >
      <span class="model-menu-name">{props.model.name}</span>
      <Show when={props.free}>
        <span class="model-menu-tag">免费</span>
      </Show>
    </button>
  )
}

export function ModelMenu() {
  const app = useModels()
  let root: HTMLDivElement | undefined

  const label = () => app.selectedModel()?.name ?? "配置模型"
  const models = () => app.selectableModels()
  const freeModels = () => models().filter((item) => item.source === "discovered")
  const configuredModels = () => models().filter((item) => item.source === "coda")

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
        <div class="model-menu model-select-menu" role="menu">
          <Show when={models().length > 0}>
            <div class="model-menu-list">
              <For each={freeModels()}>
                {(model) => (
                  <ModelMenuRow
                    model={model}
                    active={model.key === app.selectedModelKey()}
                    free
                    onSelect={app.selectModel}
                  />
                )}
              </For>
              <Show when={freeModels().length > 0 && configuredModels().length > 0}>
                <div class="model-menu-sep" />
              </Show>
              <For each={configuredModels()}>
                {(model) => (
                  <ModelMenuRow model={model} active={model.key === app.selectedModelKey()} onSelect={app.selectModel} />
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
