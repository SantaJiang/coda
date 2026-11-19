import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js"
import { markIndexOf, type MinimapMark } from "../lib/timeline-minimap"

// One slot per mark. The rail is an overlay in the reading gutter, so every
// measurement is local: no mark reads the timeline.
const SLOT = 10
const BAR_MIN = 6
const BAR_MAX = 22
const ACTIVE_GAIN = 5
const HOVER_REACH = 84
const HOVER_GAIN = 13
// The rail hugs the text: its right edge sits this far into the column, which
// is inside the 28px content padding. It therefore never depends on the gutter
// being wide, and cannot be clipped by the session container.
const RAIL_EDGE = 20
const RAIL_MAX = 40

function reducedMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

export function TurnMinimap(props: {
  marks: MinimapMark[]
  activeID: string | undefined
  /** Free space left of the reading column, in px. 0 when the window is narrow. */
  gutter: number
  hidden: boolean
  onJump: (turnID: string) => void
}) {
  let rail!: HTMLDivElement
  const [height, setHeight] = createSignal(0)
  const [pointerY, setPointerY] = createSignal<number | null>(null)
  const [hovered, setHovered] = createSignal(-1)
  const bars = new Map<string, HTMLElement>()
  const activeIndex = createMemo(() => markIndexOf(props.marks, props.activeID))
  // Grows into the gutter when there is one, collapses to the padding width
  // when there is not. The right edge never moves.
  const railWidth = createMemo(() => Math.max(RAIL_EDGE, Math.min(RAIL_MAX, RAIL_EDGE + props.gutter)))
  const railLeft = createMemo(() => RAIL_EDGE - railWidth())
  // Short windows must compress the rail instead of letting marks spill into
  // the composer, so the slot shrinks with the available height.
  const slot = createMemo(() => {
    const count = props.marks.length
    if (!count) return SLOT
    const room = height()
    return room > 0 ? Math.min(SLOT, room / count) : SLOT
  })
  const offsets = createMemo(() => {
    const count = props.marks.length
    const step = slot()
    const top = Math.max(0, (height() - count * step) / 2)
    return Array.from({ length: count }, (_, index) => top + index * step)
  })
  const center = (index: number) => (offsets()[index] ?? 0) + slot() / 2

  // Width is scale-free: the bar grows right from the rail edge, so proximity
  // never reflows the timeline behind it. Clamped so a narrow rail still keeps
  // its bars inside the rail.
  const width = (index: number) => {
    const mark = props.marks[index]
    if (!mark) return BAR_MIN
    const base = BAR_MIN + mark.weight * (BAR_MAX - BAR_MIN) + (index === activeIndex() ? ACTIVE_GAIN : 0)
    const point = pointerY()
    const grown = point === null
      ? base
      : base + Math.pow(Math.max(0, 1 - Math.abs(center(index) - point) / HOVER_REACH), 2) * HOVER_GAIN
    return Math.min(grown, railWidth() - 3)
  }

  const track = (event: PointerEvent) => {
    const point = event.clientY - rail.getBoundingClientRect().top
    setPointerY(point)
    let nearest = -1
    let distance = slot()
    for (let index = 0; index < props.marks.length; index++) {
      const delta = Math.abs(center(index) - point)
      if (delta < distance) { distance = delta; nearest = index }
    }
    setHovered(nearest)
  }
  const leave = () => { setPointerY(null); setHovered(-1) }

  onMount(() => {
    const sync = () => setHeight(rail.clientHeight)
    sync()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(sync)
    observer.observe(rail)
    onCleanup(() => observer.disconnect())
  })

  // A short pulse keeps the eye on the mark that just became current without
  // staying loud the way a persistent animation would.
  createEffect(on(activeIndex, (index, previous) => {
    if (previous === undefined || index < 0 || reducedMotion()) return
    const bar = bars.get(props.marks[index]?.id ?? "")
    if (!bar || typeof bar.animate !== "function") return
    bar.animate(
      [
        { transform: "scaleX(1)" },
        { transform: "scaleX(1.4)" },
        { transform: "scaleX(1)" },
      ],
      { duration: 400, easing: "ease-out" },
    )
  }))

  return (
    <div class="turn-minimap" data-hidden={props.hidden ? "true" : "false"} aria-hidden={props.hidden ? "true" : undefined}>
      <div class="turn-minimap-rail" ref={rail} role="navigation" aria-label="会话轮次导航"
        style={{ left: `${railLeft()}px`, width: `${railWidth()}px` }}
        onPointerMove={track} onPointerLeave={leave}>
        <For each={props.marks}>{(mark, index) => (
          <button type="button" class="turn-mark"
            style={{ top: `${offsets()[index()] ?? 0}px`, height: `${slot()}px` }}
            data-active={index() === activeIndex() ? "true" : "false"}
            data-live={mark.active ? "true" : "false"}
            data-failed={mark.failed ? "true" : "false"}
            aria-current={index() === activeIndex() ? "true" : undefined}
            tabIndex={props.hidden ? -1 : 0}
            aria-label={`跳到第 ${index() + 1} 轮${mark.question ? `：${mark.question.slice(0, 40)}` : ""}`}
            onPointerEnter={() => setHovered(index())}
            onClick={() => props.onJump(mark.id)}>
            <span class="turn-mark-bar" ref={(element) => { bars.set(mark.id, element) }}
              style={{ width: `${width(index())}px`, opacity: mark.active || mark.failed ? 1 : 0.55 + mark.weight * 0.45 }} />
            <Show when={hovered() === index()}>
              <span class="turn-mark-tip">
                <span class="turn-mark-tip-meta">
                  第 {index() + 1} 轮{mark.count > 1 ? ` 起 · 含 ${mark.count} 轮` : ""} · {mark.label}
                </span>
                <Show when={mark.question} fallback={<span class="turn-mark-tip-text is-empty">无提问</span>}>
                  <span class="turn-mark-tip-text">{mark.question}</span>
                </Show>
              </span>
            </Show>
          </button>
        )}</For>
      </div>
    </div>
  )
}
