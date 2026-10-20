import { Show } from "solid-js"
import { isTerminalRunning } from "../lib/api"
import type { Terminals } from "../lib/terminals"
import { terminalStatusLabel } from "../lib/terminals"
import { shellWaitLabel } from "../lib/terminal-policy"

export function TerminalDock(props: { terminals: Terminals }) {
  const t = props.terminals
  const recoverable = () => t.items().find((info) => info.recoverable && !info.suppressed)
  const running = () => t.visible().filter(isTerminalRunning).length
  const notice = () => {
    if (t.error()) return t.error()
    if (recoverable()?.error) return recoverable()?.error
    const tasks = t.visible().filter(isTerminalRunning)
    if (tasks.some((info) => info.suppressed)) return "AI 已停止，终端仍在运行"
    if (tasks.some((info) => t.now() - info.lastOutputAt > 300_000)) return "暂未产生新输出"
    return ""
  }
  return (
    <Show when={t.visible().length || recoverable()}>
      <div class="terminal-dock">
        <Show when={t.visible().length}><button
          class="terminal-dock-button"
          onClick={() => (t.view().open && t.view().tab === "terminal" ? t.patch({ open: false }) : t.open())}
          aria-expanded={t.view().open && t.view().tab === "terminal"}
        >
          <span aria-hidden="true">›_</span> {t.visible().length} {t.visible().length === 1 ? "Terminal" : "Terminals"}
          <span classList={{ "terminal-live-dot": running() > 0 }} />
          <span class="terminal-dock-state">
            {running() ? `${running()} 运行中` : t.selected() ? terminalStatusLabel(t.selected()!) : ""}
          </span>
        </button></Show>
        <Show when={recoverable()}>
          {(info) => (
            <button class="terminal-resume" onClick={() => void t.action(info().id, "resume")}>
              继续任务
            </button>
          )}
        </Show>
        <Show when={notice()}>
          <span class="terminal-dock-state" role="status">
            {notice()}
          </span>
        </Show>
        <Show when={t.waiting()}>
          {(info) => (
            <span class="shell-wait" role="status">
              {shellWaitLabel((info().nextCheckAt ?? t.now()) - t.now())}
            </span>
          )}
        </Show>
      </div>
    </Show>
  )
}
