import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { useApp } from "../store/app"
import { Icon } from "./Icon"

export function ComposerPlus() {
  const app = useApp()
  const [filesOpen, setFilesOpen] = createSignal(false)
  let root: HTMLDivElement | undefined

  createEffect(() => {
    if (!app.state.plusMenuOpen) setFilesOpen(false)
  })

  onMount(() => {
    const onPointer = (event: PointerEvent) => {
      if (!app.state.plusMenuOpen) return
      const target = event.target as Node | null
      if (root && target && root.contains(target)) return
      app.closePlusMenu()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") app.closePlusMenu()
    }
    document.addEventListener("pointerdown", onPointer)
    document.addEventListener("keydown", onKey)
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointer)
      document.removeEventListener("keydown", onKey)
    })
  })

  const toggle = () => {
    if (app.state.plusMenuOpen) app.closePlusMenu()
    else app.openPlusMenu()
  }

  return (
    <div class="plus-picker" ref={root}>
      <button
        type="button"
        class="plus-btn"
        classList={{ open: app.state.plusMenuOpen }}
        aria-label="更多"
        onClick={toggle}
      >
        <Icon name="plus" />
      </button>
      <Show when={app.state.plusMenuOpen}>
        <div class="model-menu plus-menu" role="menu">
          <button
            type="button"
            class="model-menu-item"
            classList={{ active: app.state.planMode }}
            role="menuitem"
            onClick={() => app.setPlanMode(true)}
          >
            Plan
          </button>
          <div class="model-menu-sep" />
          <div class="plus-files">
            <button
              type="button"
              class="model-menu-item"
              classList={{ open: filesOpen() }}
              role="menuitem"
              aria-haspopup="true"
              aria-expanded={filesOpen()}
              onClick={() => setFilesOpen((open) => !open)}
            >
              <span>Files</span>
              <Icon name="chevron-right" class="plus-caret" />
            </button>
            <Show when={filesOpen()}>
              <div class="plus-submenu" role="menu">
                <button type="button" class="model-menu-item" role="menuitem" onClick={() => void app.addFiles()}>
                  文件
                </button>
                <button type="button" class="model-menu-item" role="menuitem" onClick={() => void app.addFolder()}>
                  文件夹
                </button>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  )
}
