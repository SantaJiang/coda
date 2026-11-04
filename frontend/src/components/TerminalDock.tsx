import { For, Show, createSignal } from "solid-js"
import { isTerminalRunning } from "../lib/api"
import { terminalDisplayTitle } from "../lib/activity"
import type { TerminalInfo } from "../lib/terminal-contracts"
import type { Terminals } from "../lib/terminals"
import { shellWaitLabel } from "../lib/terminal-policy"

const TRAY_PAGE = 5
const TRAY_MORE = 8

function ranFor(info: TerminalInfo, now: number) {
  if (!info.startedAt) return ""
  const end = info.endedAt ?? now
  const seconds = Math.max(0, Math.floor((end - info.startedAt) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return `${minutes}m ${rest}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${Math.floor((seconds % 3600) / 60)}m ${rest}s`
}

export function TerminalDock(props: { terminals: Terminals }) {
  const t = props.terminals
  const [tray, setTray] = createSignal(false)
  const [limit, setLimit] = createSignal(TRAY_PAGE)
  const recoverable = () => t.items().find((info) => info.recoverable && !info.suppressed)
  const rows = () => t.visible()
  const running = () => rows().some(isTerminalRunning) || Boolean(recoverable() && !rows().some((info) => info.id === recoverable()?.id))
  const count = () => rows().length
  const notice = () => {
    if (t.error()) return t.error()
    if (recoverable()?.error) return recoverable()?.error
    const tasks = rows().filter(isTerminalRunning)
    if (tasks.some((info) => info.suppressed)) return "AI 已停止，终端仍在运行"
    if (tasks.some((info) => t.now() - info.lastOutputAt > 300_000)) return "暂未产生新输出"
    return ""
  }
  const toggle = () => {
    setTray((open) => !open)
    setLimit(TRAY_PAGE)
  }
  return (
    <Show when={count() || recoverable()}>
      <div class="terminal-dock">
        <Show when={count() && !tray()}>
          <button
            type="button"
            class="terminal-pill"
            data-pill-count={count()}
            aria-label={`Open terminals (${count()})`}
            aria-expanded={false}
            onClick={toggle}
          >
            <Show when={running()}><span class="terminal-pill-spin" aria-hidden="true" /></Show>
            <span class="terminal-pill-count">{count()}</span>
            {count() === 1 ? "Terminal" : "Terminals"}
          </button>
        </Show>
        <Show when={tray() && count()}>
          <div class="terminal-card" role="region" aria-label="Terminals">
            <div class="terminal-card-head">
              <span class="terminal-card-label">
                <span class="terminal-pill-count">{count()}</span>
                {count() === 1 ? " Terminal" : " Terminals"}
              </span>
              <button type="button" class="terminal-card-collapse" aria-label="Collapse terminals" onClick={toggle}>
                —
              </button>
            </div>
            <div class="terminal-card-list" role="list">
              <For each={rows().slice(0, limit())}>{(info) => {
                const title = () => terminalDisplayTitle(info.command)
                return <div class="terminal-card-row" role="listitem">
                  <button type="button" class="terminal-card-open" onClick={() => { t.open(info.id); setTray(false) }}>
                    <span class="terminal-card-glyph" aria-hidden="true">&gt;_</span>
                    <span class="terminal-card-title">{title()}</span>
                    <span class="terminal-card-time">{ranFor(info, t.now())}</span>
                  </button>
                  <Show when={isTerminalRunning(info)}>
                    <button type="button" class="terminal-card-kill" aria-label={`Stop ${title()}`} onClick={() => void t.action(info.id, "cancel")}>×</button>
                  </Show>
                </div>
              }}</For>
              <Show when={rows().length > limit()}>
                <button type="button" class="terminal-card-more" onClick={() => setLimit((value) => value + TRAY_MORE)}>Show more</button>
              </Show>
            </div>
          </div>
        </Show>
        <Show when={recoverable()}>
          {(info) => (
            <button class="terminal-resume" onClick={() => void t.action(info().id, "resume")}>
              继续任务
            </button>
          )}
        </Show>
        <Show when={notice()}>
          <span class="terminal-dock-state" role="status">{notice()}</span>
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
