import { onCleanup, onMount, createSignal, Show, type JSX } from "solid-js"
import { usesCustomWindowControls, isTauri } from "../lib/platform"

async function appWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window")
  return getCurrentWindow()
}

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("button, a, input, textarea, .win-controls"))
}

export function ChromeDrag(props: { class?: string; children?: JSX.Element }) {
  const onDblClick = (event: MouseEvent) => {
    if (!isTauri() || isInteractiveTarget(event.target)) return
    void appWindow().then((win) => win.toggleMaximize())
  }

  return (
    <div class={props.class} data-tauri-drag-region="" onDblClick={onDblClick}>
      {props.children}
    </div>
  )
}

export function WindowControls() {
  const visible = usesCustomWindowControls()
  const [maximized, setMaximized] = createSignal(false)

  onMount(() => {
    if (!visible) return
    let disposed = false
    let unlisten: (() => void) | undefined
    void (async () => {
      const win = await appWindow()
      const sync = async () => {
        const next = await win.isMaximized()
        if (!disposed) setMaximized(next)
      }
      await sync()
      const stop = await win.onResized(() => void sync())
      if (disposed) stop()
      else unlisten = stop
    })()
    onCleanup(() => {
      disposed = true
      unlisten?.()
    })
  })

  const run = (action: "minimize" | "toggleMaximize" | "close") => {
    void appWindow().then((win) => {
      if (action === "minimize") return win.minimize()
      if (action === "toggleMaximize") return win.toggleMaximize()
      return win.close()
    })
  }

  return (
    <Show when={visible}>
      <div class="win-controls" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" class="win-btn" title="最小化" aria-label="最小化" onClick={() => run("minimize")}>
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <rect x="2" y="5.25" width="8" height="1.5" rx="0.4" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          class="win-btn"
          title={maximized() ? "还原" : "最大化"}
          aria-label={maximized() ? "还原" : "最大化"}
          onClick={() => run("toggleMaximize")}
        >
          <Show
            when={maximized()}
            fallback={
              <svg viewBox="0 0 12 12" aria-hidden="true">
                <rect x="2.5" y="2.5" width="7" height="7" rx="0.6" fill="none" stroke="currentColor" stroke-width="1.2" />
              </svg>
            }
          >
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path
                d="M4 3.5h4.5v4.5H4zM3.2 4.8H2.5v4.7h4.7V8.8"
                fill="none"
                stroke="currentColor"
                stroke-width="1.2"
              />
            </svg>
          </Show>
        </button>
        <button type="button" class="win-btn win-close" title="关闭" aria-label="关闭" onClick={() => run("close")}>
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M3.2 3.2l5.6 5.6M8.8 3.2L3.2 8.8"
              fill="none"
              stroke="currentColor"
              stroke-width="1.2"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </div>
    </Show>
  )
}
