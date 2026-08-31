import { For, Show, onCleanup, onMount } from "solid-js"
import { formatVariantLabel } from "../lib/models"
import { useApp } from "../store/app"

export function VariantMenu() {
  const app = useApp()
  let root: HTMLDivElement | undefined
  const variants = () => app.currentVariants()

  onMount(() => {
    const onPointer = (event: PointerEvent) => {
      if (!app.state.variantMenuOpen) return
      const target = event.target as Node | null
      if (root && target && root.contains(target)) return
      app.closeVariantMenu()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") app.closeVariantMenu()
    }
    document.addEventListener("pointerdown", onPointer)
    document.addEventListener("keydown", onKey)
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointer)
      document.removeEventListener("keydown", onKey)
    })
  })

  const toggle = () => {
    if (app.state.variantMenuOpen) app.closeVariantMenu()
    else app.openVariantMenu()
  }

  return (
    <Show when={variants().length > 0}>
      <div class="model-picker" ref={root}>
        <button
          type="button"
          class="model-chip"
          classList={{ open: app.state.variantMenuOpen }}
          onClick={toggle}
        >
          {app.variantLabel()}
        </button>
        <Show when={app.state.variantMenuOpen}>
          <div class="model-menu" role="menu">
            <button
              type="button"
              class="model-menu-item"
              classList={{ active: !app.state.selectedVariant }}
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
                  classList={{ active: app.state.selectedVariant === id }}
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
