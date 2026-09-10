import { Show, createEffect, createSignal } from "solid-js"
import { useDismissable } from "../lib/dismiss"
import { useChrome, useRuntime } from "../store/app"
import { Icon } from "./Icon"

export function ComposerPlus() {
  const chrome = useChrome()
  const runtime = useRuntime()
  const [filesOpen, setFilesOpen] = createSignal(false)
  let root: HTMLDivElement | undefined

  createEffect(() => {
    if (!chrome.plusMenuOpen()) setFilesOpen(false)
  })

  useDismissable({
    active: () => chrome.plusMenuOpen(),
    onClose: () => chrome.closePlusMenu(),
    root: () => root,
  })

  const toggle = () => {
    if (chrome.plusMenuOpen()) chrome.closePlusMenu()
    else chrome.openPlusMenu()
  }

  return (
    <div class="plus-picker" ref={root}>
      <button
        type="button"
        class="plus-btn"
        classList={{ open: chrome.plusMenuOpen() }}
        aria-label="更多"
        onClick={toggle}
      >
        <Icon name="plus" />
      </button>
      <Show when={chrome.plusMenuOpen()}>
        <div class="model-menu plus-menu" role="menu">
          <button
            type="button"
            class="model-menu-item"
            classList={{ active: chrome.planMode() }}
            role="menuitem"
            onClick={() => chrome.setPlanMode(true)}
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
                <button type="button" class="model-menu-item" role="menuitem" onClick={() => void runtime.addFiles()}>
                  文件
                </button>
                <button type="button" class="model-menu-item" role="menuitem" onClick={() => void runtime.addFolder()}>
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
