import { createMemo } from "solid-js"
import { renderMarkdown } from "../lib/markdown"

export function MarkdownView(props: { text: string }) {
  const html = createMemo(() => renderMarkdown(props.text || ""))
  return <div class="markdown" innerHTML={html()} />
}
