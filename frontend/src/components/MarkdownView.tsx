import { createEffect, on, onCleanup, onMount } from "solid-js"
import { renderMarkdown } from "../lib/markdown"

export function MarkdownView(props: { text: string; streaming?: boolean; caret?: boolean }) {
  let root!: HTMLDivElement
  let displayed = ""
  let shownText: string | undefined
  let shownStreaming: boolean | undefined
  let frame: number | undefined
  const flush = () => {
    const text = props.text || ""
    const streaming = Boolean(props.streaming)
    if (!root || (text === shownText && streaming === shownStreaming)) return
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed && selection.rangeCount && selection.getRangeAt(0).intersectsNode(root)) return
    const next = renderMarkdown(text, streaming)
    shownText = text
    shownStreaming = streaming
    if (next === displayed) return
    const template = document.createElement("template")
    template.innerHTML = next
    const previousLast = root.lastElementChild
    syncChildren(root, template.content)
    displayed = next
    // Fade a block only the first time it appears. Restarting the animation on
    // every token drops the growing paragraph or list back to opacity 0.
    const node = streaming ? root.lastElementChild : undefined
    if (node && node !== previousLast && !["PRE", "SVG", "MATH"].includes(node.tagName)) {
      node.classList.add("sd-fade")
    }
  }
  // Tokens arrive faster than frames, and a memo would recompute on every one, so
  // the markdown pipeline runs inside the flush: at most once per frame, over the
  // latest text. The first render is synchronous so history never flashes empty.
  const schedule = () => {
    if (frame !== undefined) return
    frame = requestAnimationFrame(() => {
      frame = undefined
      flush()
    })
  }
  createEffect(on(() => [props.text, Boolean(props.streaming)] as const, (_value, previous) => {
    if (previous === undefined) flush()
    else schedule()
  }))
  onMount(() => {
    document.addEventListener("selectionchange", flush)
    onCleanup(() => {
      document.removeEventListener("selectionchange", flush)
      if (frame !== undefined) cancelAnimationFrame(frame)
    })
  })
  return <div class="markdown" classList={{ "is-streaming": Boolean(props.caret) }} ref={root} />
}

// Only patch changed nodes. Replacing innerHTML on every token reloads images,
// resets code/table scrolling, and discards focus even in completed paragraphs.
function syncChildren(target: Node, source: Node) {
  const incoming = [...source.childNodes]
  for (let i = 0; i < incoming.length; i++) {
    const next = incoming[i]
    const current = target.childNodes[i]
    if (!current) { target.appendChild(next.cloneNode(true)); continue }
    if (current.isEqualNode(next)) continue
    if (current.nodeType !== next.nodeType || current.nodeName !== next.nodeName) {
      target.replaceChild(next.cloneNode(true), current)
      continue
    }
    if (current.nodeType === Node.TEXT_NODE || current.nodeType === Node.COMMENT_NODE) {
      current.nodeValue = next.nodeValue
      continue
    }
    if (current instanceof Element && next instanceof Element) {
      for (const attribute of [...current.attributes])
        if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name)
      for (const attribute of [...next.attributes])
        if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value)
    }
    syncChildren(current, next)
  }
  while (target.childNodes.length > incoming.length) target.removeChild(target.lastChild!)
}
