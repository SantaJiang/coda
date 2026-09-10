import purify from "dompurify"

type Purify = { sanitize: (html: string, config?: object) => string }

function resolvePurify(): Purify | null {
  const candidate = purify as unknown as Purify & { default?: Purify }
  if (typeof candidate?.sanitize === "function") return candidate
  if (typeof candidate?.default?.sanitize === "function") return candidate.default
  return null
}

const OPTIONS = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "link", "meta", "base"],
  FORBID_ATTR: ["srcdoc"],
  ADD_ATTR: ["target", "rel", "data-kind"],
}

export function sanitizeHtml(html: string): string {
  if (!html) return ""
  const instance = resolvePurify()
  if (!instance) return html
  return String(instance.sanitize(html, OPTIONS))
}
