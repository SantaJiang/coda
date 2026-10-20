import { createEffect, createMemo, onCleanup, onMount } from "solid-js"
import { renderMarkdown } from "../lib/markdown"

export function MarkdownView(props: { text: string }) {
  const html = createMemo(() => renderMarkdown(props.text || ""))
  let displayed = ""
  let root!: HTMLDivElement
  const flush = () => {
    const next = html()
    const selection = window.getSelection()
    if (root && selection && !selection.isCollapsed && selection.rangeCount && selection.getRangeAt(0).intersectsNode(root)) return
    if (!root || next === displayed) return
    const template = document.createElement("template")
    template.innerHTML = next
    syncChildren(root, template.content)
    displayed = next
  }
  createEffect(flush)
  onMount(() => {
    document.addEventListener("selectionchange", flush)
    onCleanup(() => document.removeEventListener("selectionchange", flush))
  })
  return <div class="markdown" ref={root} />
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
