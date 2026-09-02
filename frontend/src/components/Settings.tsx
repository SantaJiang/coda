import { For, Show } from "solid-js"
import { modifierLabel, type SendShortcut } from "../lib/settings"
import { useApp } from "../store/app"
import { Icon } from "./Icon"

const CHOICES: Array<{ id: SendShortcut; name: () => string; hint: () => string }> = [
  {
    id: "enter",
    name: () => "Enter",
    hint: () => "换行使用 Shift+Enter",
  },
  {
    id: "mod-enter",
    name: () => `${modifierLabel()}+Enter`,
    hint: () => "Enter 用于换行",
  },
]

export function Settings() {
  const app = useApp()

  const onOverlay = (event: MouseEvent) => {
    if (event.target === event.currentTarget) app.closeSettings()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") app.closeSettings()
  }

  return (
    <Show when={app.state.settingsOpen}>
      <div class="dialog-overlay" onMouseDown={onOverlay} onKeyDown={onKeyDown}>
        <div class="dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <header class="dialog-head">
            <h2 id="settings-title">设置</h2>
            <button type="button" class="icon-btn" onClick={() => app.closeSettings()} aria-label="关闭">
              <Icon name="times" />
            </button>
          </header>

          <section class="settings-group">
            <div class="settings-label">发送快捷键</div>
            <div class="settings-choices">
              <For each={CHOICES}>
                {(choice) => (
                  <button
                    type="button"
                    class="settings-choice"
                    classList={{ active: app.state.sendShortcut === choice.id }}
                    onClick={() => app.setSendShortcut(choice.id)}
                  >
                    <span class="settings-choice-name">{choice.name()}</span>
                    <span class="settings-choice-desc">{choice.hint()}</span>
                  </button>
                )}
              </For>
            </div>
          </section>
        </div>
      </div>
    </Show>
  )
}
