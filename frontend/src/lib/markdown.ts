import { marked } from "marked"
import { escapeHtml, highlightCode, inlineKind } from "./highlight"

marked.setOptions({
  gfm: true,
  breaks: true,
})

const renderer = {
  code({ text, lang }: { text: string; lang?: string }) {
    const language = lang?.split(/[\s:]+/)[0]
    const html = highlightCode(text, language)
    const label = language ? `<div class="md-code-lang">${escapeHtml(language)}</div>` : ""
    return `<div class="md-code-block">${label}<pre class="md-code"><code class="hljs">${html}</code></pre></div>`
  },
  codespan({ text }: { text: string }) {
    const raw = text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    return `<code class="md-inline" data-kind="${inlineKind(raw)}">${escapeHtml(raw)}</code>`
  },
}

marked.use({ renderer })

export function renderMarkdown(source: string) {
  const html = marked.parse(source, { async: false }) as string
  return html.replace(/<table>/g, '<div class="md-table-wrap"><table>').replace(/<\/table>/g, "</table></div>")
}
