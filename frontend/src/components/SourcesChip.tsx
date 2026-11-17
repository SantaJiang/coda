import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { openExternalLink } from "../lib/desktop"
import type { TurnSources } from "../lib/sources"
import { SourceRow, SourceTile } from "./SourceRow"

const STACK = 3

/** 回答末尾的「N 个来源」：点开按搜索 / 抓取列出本轮全部来源。 */
export function SourcesChip(props: { sources: TurnSources }) {
  const [open, setOpen] = createSignal(false)
  // 胶囊靠近视口顶部时向下弹，否则向上弹；都在窗口内，不会被裁掉。
  const [placement, setPlacement] = createSignal<"up" | "down">("up")
  let root!: HTMLDivElement

  onMount(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!root.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    })
  })

  // 胶囊里每个站点只画一次，避免同一域名堆出三张一样的块。
  const sites = createMemo(() => {
    const seen = new Set<string>()
    return props.sources.sources
      .filter((source) => {
        if (seen.has(source.site)) return false
        seen.add(source.site)
        return true
      })
      .slice(0, STACK)
  })

  const toggle = () => {
    if (!open()) setPlacement(root.getBoundingClientRect().top < 340 ? "down" : "up")
    setOpen((value) => !value)
  }

  const openSource = (url: string) => {
    setOpen(false)
    void openExternalLink(url)
  }

  return (
    <div class="sources-chip-wrap" ref={root}>
      <button
        type="button"
        class="sources-chip"
        aria-expanded={open()}
        aria-haspopup="dialog"
        onClick={toggle}
      >
        <span class="sources-chip-stack">
          <For each={sites()}>{(source) => <SourceTile source={source} />}</For>
        </span>
        <span class="sources-chip-label">{props.sources.sources.length} 个来源</span>
      </button>
      <Show when={open()}>
        <div class="sources-popover" classList={{ down: placement() === "down" }} role="dialog" aria-label="本轮来源">
          <div class="sources-popover-head">本轮来源</div>
          <For each={props.sources.steps}>
            {(step) => (
              <div class="sources-step">
                <div class="sources-step-head">
                  <span class="sources-step-title">
                    <b>{step.type === "search" ? "搜索" : "抓取"}</b>
                    {step.type === "search" && step.query ? ` · ${step.query}` : ""}
                  </span>
                  <span class="sources-step-count">{step.type === "search" ? step.sources.length : 1}</span>
                </div>
                <For each={step.type === "search" ? step.sources : [step.source]}>
                  {(source) => <SourceRow source={source} onOpen={() => openSource(source.url)} />}
                </For>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
