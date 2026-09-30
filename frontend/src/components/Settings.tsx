import { createSignal, For, onMount, Show } from "solid-js"
import { version as bundledVersion } from "../../package.json"
import { modifierLabel, type SendShortcut } from "../lib/settings"
import { useChrome } from "../store/app"
import { useTheme } from "../store/theme"
import { Icon } from "./Icon"

const CHOICES: Array<{ id: SendShortcut; name: () => string; hint: () => string }> = [
  {
    id: "enter",
    name: () => "Enter",
    hint: () => `换行使用 ${modifierLabel()}+Enter`,
  },
  {
    id: "mod-enter",
    name: () => `${modifierLabel()}+Enter`,
    hint: () => "换行使用 Enter",
  },
]

export function Settings() {
  const chrome = useChrome()
  const theme = useTheme()
  const [version, setVersion] = createSignal(bundledVersion)

  onMount(() => {
    void (async () => {
      try {
        const { getVersion } = await import("@tauri-apps/api/app")
        setVersion(await getVersion())
      } catch {}
    })()
  })

  const onOverlay = (event: MouseEvent) => {
    if (event.target === event.currentTarget) chrome.closeSettings()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") chrome.closeSettings()
  }

  return (
    <Show when={chrome.settingsOpen()}>
      <div class="dialog-overlay" onMouseDown={onOverlay} onKeyDown={onKeyDown}>
        <div class="dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <header class="dialog-head">
            <h2 id="settings-title">设置</h2>
            <button type="button" class="icon-btn" onClick={() => chrome.closeSettings()} aria-label="关闭">
              <Icon name="times" />
            </button>
          </header>

          <section class="settings-group">
            <div class="settings-label">外观</div>
            <button
              type="button"
              role="switch"
              aria-checked={theme.theme() === "dark"}
              class="settings-toggle"
              onClick={() => theme.setTheme(theme.theme() === "dark" ? "light" : "dark")}
            >
              <span class="settings-toggle-text">
                <span class="settings-choice-name">深色模式</span>
                <span class="settings-choice-desc">关闭后切换为浅色主题</span>
              </span>
              <span class="settings-switch" aria-hidden="true" />
            </button>
          </section>

          <section class="settings-group">
            <div class="settings-label">发送快捷键</div>
            <div class="settings-choices">
              <For each={CHOICES}>
                {(choice) => (
                  <button
                    type="button"
                    class="settings-choice"
                    classList={{ active: chrome.sendShortcut() === choice.id }}
                    onClick={() => chrome.setSendShortcut(choice.id)}
                  >
                    <span class="settings-choice-name">{choice.name()}</span>
                    <span class="settings-choice-desc">{choice.hint()}</span>
                  </button>
                )}
              </For>
            </div>
          </section>

          <section class="settings-group">
            <div class="settings-label">后端</div>
            <button
              type="button"
              role="switch"
              aria-checked={chrome.keepBackendAlive()}
              class="settings-toggle"
              onClick={() => chrome.setKeepBackendAlive(!chrome.keepBackendAlive())}
            >
              <span class="settings-toggle-text">
                <span class="settings-choice-name">退出后保持后端运行</span>
                <span class="settings-choice-desc">关闭后，退出 Coda 时会一并停止内置后端</span>
              </span>
              <span class="settings-switch" aria-hidden="true" />
            </button>
          </section>

          <div class="settings-version">版本 {version()}</div>
        </div>
      </div>
    </Show>
  )
}
