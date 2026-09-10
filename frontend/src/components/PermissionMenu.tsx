import { For, Show } from "solid-js"
import { useDismissable } from "../lib/dismiss"
import { PERMISSION_PRESETS } from "../lib/permissions"
import { useChrome } from "../store/app"

export function PermissionMenu() {
  const app = useChrome()
  let root: HTMLDivElement | undefined

  useDismissable({
    active: () => app.permissionMenuOpen(),
    onClose: () => app.closePermissionMenu(),
    root: () => root,
  })

  const toggle = () => {
    if (app.permissionMenuOpen()) app.closePermissionMenu()
    else app.openPermissionMenu()
  }

  return (
    <div class="model-picker" ref={root}>
      <button
        type="button"
        class="model-chip"
        classList={{
          open: app.permissionMenuOpen(),
          warn: app.permissionMode() === "allow" || app.permissionMode() === "auto",
        }}
        aria-label={`权限：${app.permissionLabel()}`}
        aria-haspopup="menu"
        aria-expanded={app.permissionMenuOpen()}
        onClick={toggle}
      >
        {app.permissionLabel()}
      </button>
      <Show when={app.permissionMenuOpen()}>
        <div class="model-menu perm-menu" role="menu">
          <For each={PERMISSION_PRESETS}>
            {(preset) => (
              <button
                type="button"
                class="model-menu-item perm-menu-item"
                classList={{ active: app.permissionMode() === preset.id }}
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
