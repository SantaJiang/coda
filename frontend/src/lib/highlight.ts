import hljs from "highlight.js/lib/core"
import bash from "highlight.js/lib/languages/bash"
import c from "highlight.js/lib/languages/c"
import cpp from "highlight.js/lib/languages/cpp"
import csharp from "highlight.js/lib/languages/csharp"
import css from "highlight.js/lib/languages/css"
import diff from "highlight.js/lib/languages/diff"
import dockerfile from "highlight.js/lib/languages/dockerfile"
import go from "highlight.js/lib/languages/go"
import ini from "highlight.js/lib/languages/ini"
import java from "highlight.js/lib/languages/java"
import javascript from "highlight.js/lib/languages/javascript"
import json from "highlight.js/lib/languages/json"
import kotlin from "highlight.js/lib/languages/kotlin"
import less from "highlight.js/lib/languages/less"
import markdown from "highlight.js/lib/languages/markdown"
import php from "highlight.js/lib/languages/php"
import plaintext from "highlight.js/lib/languages/plaintext"
import python from "highlight.js/lib/languages/python"
import ruby from "highlight.js/lib/languages/ruby"
import rust from "highlight.js/lib/languages/rust"
import scss from "highlight.js/lib/languages/scss"
import sql from "highlight.js/lib/languages/sql"
import swift from "highlight.js/lib/languages/swift"
import typescript from "highlight.js/lib/languages/typescript"
import xml from "highlight.js/lib/languages/xml"
import yaml from "highlight.js/lib/languages/yaml"

hljs.registerLanguage("bash", bash)
hljs.registerLanguage("sh", bash)
hljs.registerLanguage("shell", bash)
hljs.registerLanguage("zsh", bash)
hljs.registerLanguage("c", c)
hljs.registerLanguage("h", c)
hljs.registerLanguage("cpp", cpp)
hljs.registerLanguage("cc", cpp)
hljs.registerLanguage("hpp", cpp)
hljs.registerLanguage("csharp", csharp)
hljs.registerLanguage("cs", csharp)
hljs.registerLanguage("css", css)
hljs.registerLanguage("diff", diff)
hljs.registerLanguage("patch", diff)
hljs.registerLanguage("dockerfile", dockerfile)
hljs.registerLanguage("docker", dockerfile)
hljs.registerLanguage("go", go)
hljs.registerLanguage("ini", ini)
hljs.registerLanguage("toml", ini)
hljs.registerLanguage("java", java)
hljs.registerLanguage("javascript", javascript)
hljs.registerLanguage("js", javascript)
hljs.registerLanguage("jsx", javascript)
hljs.registerLanguage("json", json)
hljs.registerLanguage("kotlin", kotlin)
hljs.registerLanguage("kt", kotlin)
hljs.registerLanguage("less", less)
hljs.registerLanguage("markdown", markdown)
hljs.registerLanguage("md", markdown)
hljs.registerLanguage("php", php)
hljs.registerLanguage("plaintext", plaintext)
hljs.registerLanguage("text", plaintext)
hljs.registerLanguage("python", python)
hljs.registerLanguage("py", python)
hljs.registerLanguage("ruby", ruby)
hljs.registerLanguage("rb", ruby)
hljs.registerLanguage("rust", rust)
hljs.registerLanguage("rs", rust)
hljs.registerLanguage("scss", scss)
hljs.registerLanguage("sql", sql)
hljs.registerLanguage("swift", swift)
hljs.registerLanguage("typescript", typescript)
hljs.registerLanguage("ts", typescript)
hljs.registerLanguage("tsx", typescript)
hljs.registerLanguage("xml", xml)
hljs.registerLanguage("html", xml)
hljs.registerLanguage("svg", xml)
hljs.registerLanguage("yaml", yaml)
hljs.registerLanguage("yml", yaml)

const ALIASES: Record<string, string> = {
  mjs: "javascript",
  cjs: "javascript",
  mts: "typescript",
  cts: "typescript",
  vue: "xml",
  svelte: "xml",
  env: "ini",
  conf: "ini",
}

export function languageFromPath(path: string) {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? ""
  if (name === "dockerfile") return "dockerfile"
  if (name === "makefile") return "bash"
  const ext = name.includes(".") ? name.split(".").pop() ?? "" : ""
  if (!ext) return undefined
  if (ALIASES[ext]) return ALIASES[ext]
  if (hljs.getLanguage(ext)) return ext
  return undefined
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export function inlineKind(text: string) {
  const value = text.trim()
  if (!value) return "ident"
  if (/^(['"`]).*\1$/.test(value)) return "string"
  if (/^[+-]?\d[\d_]*(\.\d+)?$/.test(value)) return "number"
  if (/[/\\]/.test(value) || /\.\w{1,8}$/.test(value) || /^[A-Za-z0-9_.-]+\.[A-Za-z0-9]+$/.test(value)) return "path"
  if (
    /^(const|let|var|function|class|return|import|export|from|type|interface|async|await|true|false|null|undefined)$/.test(
      value,
    )
  ) {
    return "keyword"
  }
  return "ident"
}

function unescapeHtml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
}

export function highlightCode(code: string, language?: string) {
  const source = unescapeHtml(code).replace(/\n$/, "")
  const lang = language?.trim().split(/[\s:]+/)[0]?.toLowerCase()
  if (!source) return ""
  if (lang === "plaintext" || lang === "text" || lang === "plain") return escapeHtml(source)
  if (lang && hljs.getLanguage(lang)) {
    try {
      return hljs.highlight(source, { language: lang, ignoreIllegals: true }).value
    } catch {
      // fall through
    }
  }
  try {
    return hljs.highlightAuto(source).value
  } catch {
    return escapeHtml(source)
  }
}

function diffKind(line: string) {
  if (
    line.startsWith("diff ") ||
    line.startsWith("index ") ||
    line.startsWith("+++") ||
    line.startsWith("---") ||
    line.startsWith("new file") ||
    line.startsWith("deleted file")
  ) {
    return "meta" as const
  }
  if (line.startsWith("@@")) return "hunk" as const
  if (line.startsWith("+")) return "add" as const
  if (line.startsWith("-")) return "del" as const
  return "ctx" as const
}

export function highlightDiff(patch: string, language?: string) {
  const lines = patch.replace(/\n$/, "").split("\n")
  return lines
    .map((line) => {
      const kind = diffKind(line)
      const gutter =
        kind === "add" ? "+" : kind === "del" ? "-" : kind === "ctx" && line.startsWith(" ") ? " " : ""
      const body =
        kind === "add" || kind === "del" || (kind === "ctx" && line.startsWith(" "))
          ? line.slice(1)
          : line
      const code =
        kind === "meta" || kind === "hunk" || !language
          ? escapeHtml(body)
          : highlightCode(body, language)
      return `<div class="diff-line ${kind}"><span class="diff-gutter">${gutter}</span><span class="diff-code">${code}</span></div>`
    })
    .join("")
}
