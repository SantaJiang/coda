import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { renderMarkdown } from "../lib/markdown"

export function MarkdownView(props: { text: string }) {
  const html = createMemo(() => renderMarkdown(props.text || ""))
  const [displayed, setDisplayed] = createSignal(html())
  let root!: HTMLDivElement
  const flush = () => {
    const next = html()
    const selection = window.getSelection()
    if (root && selection && !selection.isCollapsed && selection.rangeCount && selection.getRangeAt(0).intersectsNode(root)) return
    setDisplayed(next)
  }
  createEffect(flush)
  onMount(() => {
    document.addEventListener("selectionchange", flush)
    onCleanup(() => document.removeEventListener("selectionchange", flush))
  })
  return <div class="markdown" ref={root} innerHTML={displayed()} />
}
