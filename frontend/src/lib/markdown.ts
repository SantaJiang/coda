import { marked } from "marked"
import { escapeHtml, highlightCode, inlineKind } from "./highlight"
import { sanitizeHtml } from "./sanitize"

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
    const kind = inlineKind(raw)
    const attr = kind ? ` data-kind="${kind}"` : ""
    return `<code class="md-inline"${attr}>${escapeHtml(raw)}</code>`
  },
}

marked.use({ renderer })

// GFM 会把 "www." 开头的文本自动识别成链接，并且一路吞到空白符为止——
// 中文没有空格，导致引号里的 www.xxx 之后整段话都变成链接色。
// 只保留带协议头的显式链接，www./邮箱式自动链接按纯文本渲染。
marked.use({
  tokenizer: {
    url(src: string) {
      if (/^https?:\/\//i.test(src)) return false
      return undefined
    },
  },
})

export function renderMarkdown(source: string) {
  const html = marked.parse(source, { async: false }) as string
  const wrapped = html.replace(/<table>/g, '<div class="md-table-wrap"><table>').replace(/<\/table>/g, "</table></div>")
  return sanitizeHtml(wrapped)
}
