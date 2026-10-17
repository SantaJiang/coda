import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js"
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

  createEffect(() => {
    if (!chrome.settingsOpen()) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return
      event.preventDefault()
      event.stopPropagation()
      chrome.closeSettings()
    }
    document.addEventListener("keydown", onKey, true)
    onCleanup(() => document.removeEventListener("keydown", onKey, true))
  })

  return (
    <Show when={chrome.settingsOpen()}>
      <div class="dialog-overlay" onMouseDown={onOverlay}>
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
            <div class="settings-label">后端异常中断后的任务恢复</div>
            <div class="settings-choices">
              <button class="settings-choice" classList={{ active: chrome.taskRecovery() === "auto" }} onClick={() => chrome.setTaskRecovery("auto")}>
                <span class="settings-choice-name">自动继续</span><span class="settings-choice-desc">检查任务状态后继续，权限请求仍需确认</span>
              </button>
              <button class="settings-choice" classList={{ active: chrome.taskRecovery() === "manual" }} onClick={() => chrome.setTaskRecovery("manual")}>
                <span class="settings-choice-name">手动继续</span><span class="settings-choice-desc">保留中断记录，点击继续任务后恢复</span>
              </button>
            </div>
          </section>
          <section class="settings-group">
            <div class="settings-label">停止按钮行为</div>
            <div class="settings-choices">
              <button class="settings-choice" classList={{ active: chrome.stopBehavior() === "all" }} onClick={() => chrome.setStopBehavior("all")}>
                <span class="settings-choice-name">停止 AI 与本轮命令</span><span class="settings-choice-desc">同时终止当前轮次仍在运行的终端</span>
              </button>
              <button class="settings-choice" classList={{ active: chrome.stopBehavior() === "ai" }} onClick={() => chrome.setStopBehavior("ai")}>
                <span class="settings-choice-name">只停止 AI</span><span class="settings-choice-desc">终端继续运行，完成后不会自动唤醒 AI</span>
              </button>
            </div>
          </section>
          <p class="settings-choice-desc">关闭窗口后 Coda 留在系统托盘；通过托盘“退出 Coda”停止所有任务。</p>

          <div class="settings-version">版本 {version()}</div>
        </div>
      </div>
    </Show>
  )
}
