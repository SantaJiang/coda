import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import type { Terminal as GhosttyTerminal } from "ghostty-web"
import wasmURL from "ghostty-web/ghostty-vt.wasm?url"
import { isTerminalRunning } from "../lib/api"
import type { TerminalInfo, TerminalLog } from "../lib/terminal-contracts"
import { defaultTerminalClient, type TerminalClient } from "../lib/terminal-client"
import type { Terminals } from "../lib/terminals"
import { useTheme } from "../store/theme"

export default function TerminalPanel(props: { terminals: Terminals; directory: string; sessionID: string }) {
  const t = props.terminals
  return (
    <div class="terminal-panel">
      <Show when={t.error()}>
        <div class="terminal-notice" role="alert">
          {t.error()}
        </div>
      </Show>
      <Show when={t.selected()?.id} keyed>
        {(_id) => {
          const info = () => t.selected()!
          return (
            <TerminalOutput
              client={t.client}
              directory={props.directory}
              sessionID={props.sessionID}
              info={info()}
              scroll={t.view().scroll[info().id] ?? 0}
              onScroll={(scroll) =>
                t.patch({
                  scroll: { ...t.view().scroll, [info().id]: scroll },
                })
              }
            />
          )
        }}
      </Show>
    </div>
  )
}

export function TerminalOutput(props: {
  client?: TerminalClient
  directory: string
  sessionID: string
  info: TerminalInfo
  scroll: number
  onScroll: (value: number) => void
}) {
  let host!: HTMLDivElement
  let terminal: GhosttyTerminal | undefined
  let disposed = false
  let updatingOutput = false
  let replaying = false
  let disconnect: (() => void) | undefined
  let earliest = 0,
    cursor = 0,
    baseCursor = 0
  let decoder = new TextDecoder()
  const initialScroll = props.scroll
  const [error, setError] = createSignal("")
  const [earlier, setEarlier] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  const [ready, setReady] = createSignal(false)
  const [hasOutput, setHasOutput] = createSignal(false)
  const [following, setFollowing] = createSignal(initialScroll <= 1)
  const theme = useTheme()
  const colors = () =>
    theme.resolvedTheme() === "dark"
      ? {
          background: "#151517",
          foreground: "#dedee3",
          cursor: "#dedee3",
          selectionBackground: "#414157",
          black: "#2b2b31",
          red: "#ff7a85",
          green: "#69d89b",
          yellow: "#e8c56c",
          blue: "#78b7ff",
          magenta: "#d5a0ff",
          cyan: "#67d7cd",
          white: "#dedee3",
          brightBlack: "#787884",
          brightRed: "#ff9aa3",
          brightGreen: "#8ee8b5",
          brightYellow: "#f3d98f",
          brightBlue: "#a0ccff",
          brightMagenta: "#e5c2ff",
          brightCyan: "#91e7df",
          brightWhite: "#f6f6f8",
        }
      : {
          background: "#fafafa",
          foreground: "#242429",
          cursor: "#242429",
          selectionBackground: "#d6e5fb",
          black: "#242429",
          red: "#b8312f",
          green: "#1b6f41",
          yellow: "#7c5a00",
          blue: "#1d57a8",
          magenta: "#8535a6",
          cyan: "#0d6661",
          white: "#6a6a75",
          brightBlack: "#8b8b96",
          brightRed: "#d04543",
          brightGreen: "#238a52",
          brightYellow: "#946d00",
          brightBlue: "#2868c4",
          brightMagenta: "#9c45bf",
          brightCyan: "#147a74",
          brightWhite: "#242429",
        }
  createEffect(() => {
    const value = colors()
    if (terminal) terminal.options.theme = value
  })
  const write = (frame: TerminalLog) => {
    if (!terminal || disposed) return
    if (frame.truncated) {
      decoder = new TextDecoder()
    }
    const bytes = Uint8Array.from(atob(frame.data), (char) => char.charCodeAt(0))
    const text = (frame.truncated ? "\r\n[更早的输出已轮转]\r\n" : "") + decoder.decode(bytes, { stream: !frame.ended })
    // Ghostty's WASM allocator does not accept zero-length writes (heartbeats have no output).
    if (text) {
      const hold = ready() && !following() && !replaying
      const viewport = hold ? terminal.getViewportY() : 0
      const lines = hold ? terminal.getScrollbackLength() : 0
      updatingOutput = true
      try {
        // Ghostty.write always jumps to the bottom. Restore the inspected
        // buffer line before paint, including newly appended scrollback rows.
        terminal.write(text)
        if (hold) terminal.scrollToLine(viewport + Math.max(0, terminal.getScrollbackLength() - lines))
      } finally { updatingOutput = false }
      setHasOutput(true)
      if (hold) props.onScroll(terminal.getViewportY())
    }
    cursor = frame.cursor
    baseCursor = frame.baseCursor
    if (following()) terminal.scrollToBottom()
  }
  const client = props.client ?? defaultTerminalClient
  const connect = () => {
    disconnect?.()
    disconnect = client.subscribe(props.directory, props.sessionID, props.info.id, cursor,
      (frame) => { if (!disposed) write(frame) },
      (message) => { if (!disposed) setError(message) })
  }
  const loadEarlier = async () => {
    if (!terminal || loading()) return
    setLoading(true)
    disconnect?.()
    try {
      const start = Math.max(baseCursor, earliest - 64 * 1024)
      const end = cursor
      const frames: TerminalLog[] = []
      let next = start
      // Replay at most 2 MiB at a time; the scrollback itself is bounded too.
      const replayEnd = Math.min(end, start + 2 * 1024 * 1024)
      while (next < replayEnd && !disposed) {
        const frame = await client.log(
          props.directory,
          props.sessionID,
          props.info.id,
          next,
          Math.min(64 * 1024, replayEnd - next),
        )
        if (frame.cursor <= next) throw new Error("未能读取更早日志，请重试")
        frames.push(frame)
        next = frame.cursor
      }
      if (disposed) return
      // Keep the current screen intact while fetching, then replay in one turn.
      replaying = true
      setFollowing(false)
      terminal.reset()
      decoder = new TextDecoder()
      earliest = start
      cursor = start
      for (const frame of frames) write(frame)
      terminal.scrollToTop()
      setEarlier(start > baseCursor)
      props.onScroll(terminal.getViewportY())
    } catch (e) {
      if (!disposed) setError(String(e))
    } finally {
      replaying = false
      setLoading(false)
      if (!disposed) connect()
    }
  }
  onMount(() => {
    void (async () => {
      try {
        const { Ghostty, Terminal, FitAddon } = await import("ghostty-web")
        const ghostty = await Ghostty.load(wasmURL)
        if (disposed) return
        terminal = new Terminal({
          ghostty,
          disableStdin: true,
          cursorBlink: false,
          fontSize: 12,
          fontFamily: "SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          scrollback: 20000,
          theme: colors(),
        })
        // Ghostty.open calls focus immediately AND on a timer. This read-only
        // viewer must never move focus or scroll the window away from Composer.
        terminal.focus = () => {}
        terminal.open(host)
        // Ghostty marks its host editable by default. A viewer must also disable
        // that browser editing surface, otherwise WebKit draws an insertion caret.
        host.setAttribute("contenteditable", "false")
        host.setAttribute("role", "log")
        host.setAttribute("aria-label", "只读终端输出")
        host.removeAttribute("aria-multiline")
        terminal.textarea?.setAttribute("readonly", "")
        terminal.textarea?.setAttribute("tabindex", "-1")
        terminal.textarea?.setAttribute("aria-hidden", "true")
        if (terminal.textarea) {
          const focus = terminal.textarea.focus.bind(terminal.textarea)
          terminal.textarea.focus = (options) => focus({ ...options, preventScroll: true })
        }
        terminal.attachCustomKeyEventHandler((event) => {
          if (!event.metaKey && !event.ctrlKey) return false
          const key = event.key.toLowerCase()
          if (key === "a") terminal?.selectAll()
          else if (key === "c") terminal?.copySelection()
          else if (key !== "v") return false
          // Ghostty's custom handler consumes events when returning true.
          // Pasting is intentionally consumed because this is a read-only viewer.
          return true
        })
        terminal.blur()
        const fit = new FitAddon()
        terminal.loadAddon(fit)
        // The host is absolutely positioned, so its box is the pane, not the
        // canvas. Fit must run after that box has a size; an early 0×0 measure
        // would leave the default 80 columns and clip every line.
        const refit = () => fit.fit()
        refit()
        requestAnimationFrame(refit)
        const observer = new ResizeObserver(() => refit())
        observer.observe(host)
        const scroll = terminal.onScroll(() => {
          if (!terminal || updatingOutput || replaying) return
          const value = terminal.getViewportY()
          setFollowing(value <= 1)
          props.onScroll(value)
        })
        onCleanupSafe = () => {
          observer.disconnect()
          scroll.dispose()
        }
        const initial = await client.log(props.directory, props.sessionID, props.info.id)
        if (disposed) return
        earliest = initial.start
        setEarlier(initial.start > initial.baseCursor)
        write(initial)
        setReady(true)
        if (initialScroll > 1) terminal.scrollLines(-initialScroll)
        connect()
      } catch (e) {
        if (!disposed) setError(String(e))
      }
    })()
  })
  let onCleanupSafe: (() => void) | undefined
  onCleanup(() => {
    disposed = true
    disconnect?.()
    onCleanupSafe?.()
    terminal?.dispose()
  })
  return (
    <div class="terminal-output">
      <Show when={!error() && !hasOutput()}>
        <div class="terminal-notice" role="status">
          {!ready() ? "正在加载终端输出…" : isTerminalRunning(props.info) ? "运行中，暂未产生输出" : "终端已结束，暂无输出"}
        </div>
      </Show>
      <Show when={earlier()}>
        <button type="button" class="terminal-earlier" disabled={loading()} onClick={() => void loadEarlier()}>
          {loading() ? "加载中…" : "加载更早日志"}
        </button>
      </Show>
      <Show when={error()}>
        <div class="terminal-notice" role="alert">
          {error()}
        </div>
      </Show>
      <div class="terminal-screen">
        <div ref={host} class="terminal-canvas" aria-label="只读终端输出" />
        <Show when={!following()}>
          <button
            type="button"
            class="terminal-follow"
            onClick={() => {
              setFollowing(true)
              terminal?.scrollToBottom()
            }}
          >
            回到最新
          </button>
        </Show>
      </div>
    </div>
  )
}
