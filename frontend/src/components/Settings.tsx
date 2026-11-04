import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { version as bundledVersion } from "../../package.json"
import { conversationDensity, setConversationDensity, type DensityChoice } from "../lib/density"
import { modifierLabel, type CloseBehavior, type SendShortcut, type StopBehavior, type TaskRecovery } from "../lib/settings"
import { useChrome } from "../store/app"
import { useTheme } from "../store/theme"
import { Icon } from "./Icon"

function Segment<T extends string>(props: {
  label: string
  value: T
  options: Array<{ id: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <div class="settings-row">
      <div class="settings-row-label">{props.label}</div>
      <div class="settings-seg" role="radiogroup" aria-label={props.label}>
        <For each={props.options}>
          {(option) => (
            <button
              type="button"
              role="radio"
              aria-checked={props.value === option.id}
              classList={{ active: props.value === option.id }}
              onClick={() => props.onChange(option.id)}
            >
              {option.label}
            </button>
          )}
        </For>
      </div>
    </div>
  )
}

const DENSITY_STOPS: DensityChoice[] = ["compact-all-grouped", "compact-ungrouped", "detailed"]

function densityChoice(): DensityChoice {
  const value = conversationDensity()
  return value === "detailed" || value === "compact-ungrouped" ? value : "compact-all-grouped"
}

/** Cursor Glass exposes three stops on one slider: Compact · Balanced · Detailed. */
function DensitySlider() {
  const index = () => Math.max(0, DENSITY_STOPS.indexOf(densityChoice()))
  return (
    <div class="settings-row settings-density-row">
      <div class="settings-row-label">会话流详细程度</div>
      <div class="settings-density">
        <span class="settings-density-end">Compact</span>
        <input
          type="range"
          class="settings-density-slider"
          min={0}
          max={2}
          step={1}
          value={index()}
          aria-label="Conversation density"
          aria-valuetext={densityChoice() === "compact-all-grouped" ? "Compact" : densityChoice() === "compact-ungrouped" ? "Balanced" : "Detailed"}
          onInput={(event) => setConversationDensity(DENSITY_STOPS[Number(event.currentTarget.value)] ?? "compact-all-grouped")}
        />
        <span class="settings-density-end">Detailed</span>
      </div>
    </div>
  )
}

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

          <div class="settings-list">
            <div class="settings-row">
              <div id="settings-theme" class="settings-row-label">深色模式</div>
              <button
                type="button"
                role="switch"
                aria-checked={theme.theme() === "dark"}
                aria-labelledby="settings-theme"
                class="settings-switch-btn"
                onClick={() => theme.setTheme(theme.theme() === "dark" ? "light" : "dark")}
              >
                <span class="settings-switch" aria-hidden="true" />
              </button>
            </div>

            <Segment<SendShortcut>
              label="发送"
              value={chrome.sendShortcut()}
              options={[
                { id: "enter", label: "Enter" },
                { id: "mod-enter", label: `${modifierLabel()}+Enter` },
              ]}
              onChange={chrome.setSendShortcut}
            />
            <Segment<TaskRecovery>
              label="中断恢复"
              value={chrome.taskRecovery()}
              options={[
                { id: "auto", label: "自动继续" },
                { id: "manual", label: "手动继续" },
              ]}
              onChange={chrome.setTaskRecovery}
            />
            <Segment<StopBehavior>
              label="停止时"
              value={chrome.stopBehavior()}
              options={[
                { id: "all", label: "AI 和终端" },
                { id: "ai", label: "只停 AI" },
              ]}
              onChange={chrome.setStopBehavior}
            />
            <DensitySlider />
            <Segment<CloseBehavior>
              label="关闭窗口"
              value={chrome.closeBehavior()}
              options={[
                { id: "quit", label: "直接退出" },
                { id: "tray", label: "最小化到托盘" },
              ]}
              onChange={chrome.setCloseBehavior}
            />
            <div class="settings-row">
              <div class="settings-row-label">MCP</div>
              <button type="button" class="text-btn" onClick={() => chrome.openMcpSettings()}>管理</button>
            </div>
          </div>

          <div class="settings-version">版本 {version()}</div>
        </div>
      </div>
    </Show>
  )
}
