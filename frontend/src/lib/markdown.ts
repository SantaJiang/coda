import { marked, Tokenizer } from "marked"
import { escapeHtml, highlightCode, inlineKind } from "./highlight"
import { sanitizeHtml } from "./sanitize"

marked.setOptions({
  gfm: true,
  breaks: true,
})

// marked parses synchronously, so per-parse state can live at module level and the
// renderer keeps the same signature. `streamTail` holds the source while a code
// fence is still open, so the block being written can skip highlighting.
let streamTail: string | null = null

const renderer = {
  code({ text, lang }: { text: string; lang?: string }) {
    const language = lang?.split(/[\s:]+/)[0]
    const tail = text.trimEnd()
    const open = Boolean(tail && streamTail?.endsWith(tail))
    const html = open ? escapeHtml(text) : highlightCode(text, language)
    const label = language ? `<div class="md-code-lang">${escapeHtml(language)}</div>` : ""
    return `<div class="md-code-block">${label}<pre class="md-code"><code class="hljs">${html}</code></pre></div>`
  },
  codespan({ text }: { text: string }) {
    const raw = text
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

// 汉字不算空白。**“引用”**、**注意：**后文 这种紧贴标点的写法，
// 星号开不了也关不上，会原样留在段落里。默认规则失败时，再把贴着 * 的汉字当成空白试一次。
const cjkChar = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const cjkBesideAsterisk = /(?<=\*)[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}](?=\*)/gu

marked.use({
  tokenizer: {
    emStrong(src, maskedSrc, prevChar = "") {
      const found = Tokenizer.prototype.emStrong.call(this, src, maskedSrc, prevChar)
      if (found) return found
      const adjustedPrev = cjkChar.test(prevChar) ? "" : prevChar
      cjkBesideAsterisk.lastIndex = 0
      const adjustedMask = maskedSrc.replace(cjkBesideAsterisk, " ")
      if (adjustedPrev === prevChar && adjustedMask === maskedSrc) return false
      const token = Tokenizer.prototype.emStrong.call(this, src, adjustedMask, adjustedPrev)
      if (!token) return false
      const openRun = token.raw.match(/^\*+|^_+/)?.[0] ?? ""
      const closeRun = token.raw.match(/\*+$|_+$/)?.[0] ?? ""
      // 重试若把 *** 拆成一颗星的强调，会留下多余的 *。成对的 ** 后面多出来的星号不算拆开。
      if (openRun.length !== closeRun.length || openRun[0] !== closeRun[0]) return false
      if (openRun.length === 1 && src.startsWith(openRun, token.raw.length)) return false
      return token
    },
  },
})

// 代码围栏要等模型写完才有意义；奇数个围栏行说明最后一块还在写。
// 判断错了顶多让高亮晚一帧，不影响内容。
function hasOpenFence(source: string) {
  const fences = source.match(/^ {0,3}(?:```|~~~)/gm)
  return Boolean(fences && fences.length % 2 === 1)
}

// 流式文本是一条 token 一条到的：还没写完的 ** 会先以裸星号显示，下一个 token 才变成粗体，
// 段落整体跳一下。这里只给"最后一段里仍开着"的强调符补上结尾，让正文立刻读起来是格式化的；
// 模型真写了一颗孤立的 ** 时，最后一段结束时它仍会照原样显示。
const TAIL_WINDOW = 240

function closeTail(source: string) {
  const cut = Math.max(source.lastIndexOf("\n\n"), 0)
  const tail = source.slice(cut)
  let open = ""
  let at = -1
  let codeRun = 0
  for (let i = 0; i < tail.length; i++) {
    const char = tail[i]
    // 转义符和行内代码里的星号不是标记，跳过它们，别把 `a**b` 补成两半。
    if (char === "\\") {
      i += 1
      continue
    }
    // 行内代码用等长的反引号串开合，``a`` 里的内容不算标记。
    if (char === "`") {
      let run = 1
      while (tail[i + run] === "`") run += 1
      if (!codeRun) codeRun = run
      else if (run === codeRun) codeRun = 0
      i += run - 1
      continue
    }
    if (codeRun) continue
    const pair = tail.slice(i, i + 2)
    if (pair !== "**" && pair !== "~~") continue
    // 标记后面跟着空白就开不了强调（"输入 ** 就是加粗"），补结尾只会凭空多两个星号。
    const opens = i + 2 < tail.length && !/\s/.test(tail[i + 2])
    if (open === pair) {
      open = ""
      at = -1
    } else if (!open && opens) {
      open = pair
      at = i
    }
    i += 1
  }
  // 只补刚落笔的那个标记。很久以前就没配对的更像模型本来就没打算闭合，补上反而改错。
  if (!open || tail.length - at > TAIL_WINDOW) return source
  return source + open
}

export function renderMarkdown(source: string, streaming = false) {
  const open = streaming && hasOpenFence(source)
  const text = streaming && !open ? closeTail(source) : source
  streamTail = open ? source.trimEnd() : null
  try {
    const html = marked.parse(text, { async: false }) as string
    const wrapped = html.replace(/<table>/g, '<div class="md-table-wrap"><table>').replace(/<\/table>/g, "</table></div>")
    return sanitizeHtml(wrapped)
  } finally {
    streamTail = null
  }
}
