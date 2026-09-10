import { For, Show } from "solid-js"
import { useDismissable } from "../lib/dismiss"
import { formatVariantLabel } from "../lib/models"
import { useModels } from "../store/app"

export function VariantMenu() {
  const app = useModels()
  let root: HTMLDivElement | undefined
  const variants = () => app.currentVariants()

  useDismissable({
    active: () => app.variantMenuOpen(),
    onClose: () => app.closeVariantMenu(),
    root: () => root,
  })

  const toggle = () => {
    if (app.variantMenuOpen()) app.closeVariantMenu()
    else app.openVariantMenu()
  }

  return (
    <Show when={variants().length > 0}>
      <div class="model-picker" ref={root}>
        <button
          type="button"
          class="model-chip"
          classList={{ open: app.variantMenuOpen() }}
          onClick={toggle}
        >
          {app.variantLabel()}
        </button>
        <Show when={app.variantMenuOpen()}>
          <div class="model-menu" role="menu">
            <button
              type="button"
              class="model-menu-item"
              classList={{ active: !app.selectedVariant() }}
              role="menuitem"
              onClick={() => app.setVariant(null)}
            >
              Default
            </button>
            <For each={variants()}>
              {(id) => (
                <button
                  type="button"
                  class="model-menu-item"
                  classList={{ active: app.selectedVariant() === id }}
                  role="menuitem"
                  onClick={() => app.setVariant(id)}
                >
                  {formatVariantLabel(id)}
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  )
}
