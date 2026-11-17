import { For, Show, createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js"
import type { TurnLabel } from "../lib/conversation"

export type StatusLine = { current: string; previous: string; flipping: boolean; tick: number; announce: string; clock: boolean }
const FLIP_MS = 320

/** Owned by the turn so transitions survive moving between the work group and prose tail. */
export function useStatusLine(label: Accessor<TurnLabel>, active: Accessor<boolean>) {
  const initial = label()
  const start = { key: initial.key, text: initial.text, announce: initial.announce, clock: initial.clock === true }
  const [line, setLine] = createSignal<StatusLine>({
    current: start.text, previous: "", flipping: false, tick: 0, announce: start.announce, clock: start.clock,
  })
  let timer: number | undefined
  let shown = start
  let tick = 0
  createEffect(on(() => [label(), active()] as const, ([next, live]) => {
    const clock = next.clock === true
    // Same identity: a countdown re-words itself in place. Flipping, restarting the wave,
    // or rewording the live region once per second is pure noise.
    if (next.key === shown.key) {
      if (next.text === shown.text && next.announce === shown.announce && clock === shown.clock) return
      shown = { key: shown.key, text: next.text, announce: next.announce, clock }
      setLine({ current: shown.text, previous: "", flipping: false, tick, announce: shown.announce, clock: shown.clock })
      return
    }
    window.clearTimeout(timer)
    const previous = shown.text
    shown = { key: next.key, text: next.text, announce: next.announce, clock }
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const flipping = live && Boolean(previous && previous !== next.text) && !reduced
    if (flipping) tick++
    setLine({
      current: next.text, previous: flipping ? previous : "", flipping, tick, announce: next.announce, clock,
    })
    if (flipping) timer = window.setTimeout(() => setLine({
      current: shown.text, previous: "", flipping: false, tick, announce: shown.announce, clock: shown.clock,
    }), FLIP_MS)
  }))
  onCleanup(() => window.clearTimeout(timer))
  return line
}

export function StatusText(props: { line: StatusLine; active?: boolean }) {
  // The visible line may carry a ticking countdown; `announce` stays stable so assistive
  // tech hears a state change, not a new sentence every second.
  return <span class="work-status" role="status" aria-live="polite" aria-atomic="true" aria-label={props.line.announce}>
    <For each={[props.line.tick]}>{() => <span class="work-status-flip" classList={{ flipping: props.line.flipping }}>
      <Show when={props.line.previous}><span class="work-status-line out" aria-hidden="true">{props.line.previous}</span></Show>
      <span class="work-status-line in"><span classList={{ "work-status-wave": props.active && !props.line.clock, "shell-wait": props.line.clock }}>{props.line.current}</span></span>
    </span>}</For>
  </span>
}
