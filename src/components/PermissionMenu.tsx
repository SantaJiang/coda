import { For, Show, onCleanup, onMount } from "solid-js"
import { PERMISSION_PRESETS } from "../lib/permissions"
import { useApp } from "../store/app"

export function PermissionMenu() {
  const app = useApp()
  let root: HTMLDivElement | undefined

  onMount(() => {
    const onPointer = (event: PointerEvent) => {
      if (!app.state.permissionMenuOpen) return
      const target = event.target as Node | null
      if (root && target && root.contains(target)) return
      app.closePermissionMenu()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") app.closePermissionMenu()
    }
    document.addEventListener("pointerdown", onPointer)
    document.addEventListener("keydown", onKey)
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointer)
      document.removeEventListener("keydown", onKey)
    })
  })

  const toggle = () => {
    if (app.state.permissionMenuOpen) app.closePermissionMenu()
    else app.openPermissionMenu()
  }

  return (
    <div class="model-picker" ref={root}>
      <button
        type="button"
        class="model-chip"
        classList={{
          open: app.state.permissionMenuOpen,
          warn: app.state.permissionMode === "allow",
        }}
        aria-label={`权限：${app.permissionLabel()}`}
        aria-haspopup="menu"
        aria-expanded={app.state.permissionMenuOpen}
        onClick={toggle}
      >
        {app.permissionLabel()}
      </button>
      <Show when={app.state.permissionMenuOpen}>
        <div class="model-menu perm-menu" role="menu">
          <For each={PERMISSION_PRESETS}>
            {(preset) => (
              <button
                type="button"
                class="model-menu-item perm-menu-item"
                classList={{ active: app.state.permissionMode === preset.id }}
                role="menuitem"
                onClick={() => void app.setPermissionMode(preset.id)}
              >
                <span class="perm-menu-name">{preset.label}</span>
                <span class="perm-menu-desc">{preset.description}</span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
