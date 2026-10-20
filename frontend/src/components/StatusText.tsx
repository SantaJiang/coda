import { For, Show, createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js"

export type StatusLine = { current: string; previous: string; flipping: boolean; tick: number }
const FLIP_MS = 320
const countdown = (label: string) => /^(Waiting up to \d+m \d+s for shell|Retrying(?: in \d+s)?(?: · attempt \d+)?)$/.test(label)

/** Owned by the turn so transitions survive moving between the work group and prose tail. */
export function useStatusLine(label: Accessor<string>, active: Accessor<boolean>) {
  const [line, setLine] = createSignal<StatusLine>({ current: label(), previous: "", flipping: false, tick: 0 })
  let timer: number | undefined
  let shown = label()
  let tick = 0
  createEffect(on(() => [label(), active()] as const, ([next, live]) => {
    if (shown === next && live) return
    window.clearTimeout(timer)
    const previous = shown
    shown = next
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const flipping = live && Boolean(previous && previous !== next) && !reduced && !(countdown(previous) && countdown(next))
    if (flipping) tick++
    setLine({ current: next, previous: flipping ? previous : "", flipping, tick })
    if (flipping) timer = window.setTimeout(() => setLine({ current: shown, previous: "", flipping: false, tick }), FLIP_MS)
  }))
  onCleanup(() => window.clearTimeout(timer))
  return line
}

export function StatusText(props: { line: StatusLine; active?: boolean }) {
  return <span class="work-status" role="status" aria-live="polite" aria-atomic="true" aria-label={props.line.current}>
    <For each={[props.line.tick]}>{() => <span class="work-status-flip" classList={{ flipping: props.line.flipping }}>
      <Show when={props.line.previous}><span class="work-status-line out" aria-hidden="true">{props.line.previous}</span></Show>
      <span class="work-status-line in"><span classList={{ "work-status-wave": props.active && !countdown(props.line.current), "shell-wait": countdown(props.line.current) }}>{props.line.current}</span></span>
    </span>}</For>
  </span>
}
