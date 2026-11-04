import type { ReasoningPart } from "./types"

function stripThoughtHeader(text: string) {
  return text.replace(/^\s*(?:\*\*[^*\n]+\*\*|#{1,6}\s+\S.*)\s*\n?/, "").trim()
}

/** Drop quote-only / whitespace shells so thoughts don't leave a lone `>` row. */
export function meaningfulThought(text: string) {
  return text
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, "")
    .trim()
}

/** Collapse Glass-style spacer runs so open thoughts don't look like empty rows. */
function compactThoughtSpacing(text: string) {
  return text.replace(/\n{3,}/g, "\n\n").trim()
}

export function thinkingBody(part: ReasoningPart) {
  const raw = part.text.replace(/[\u200B\u200C\u200D\uFEFF]/g, "").trim()
  if (!raw || !meaningfulThought(raw)) return ""
  const body = stripThoughtHeader(raw)
  if (!body && (/^\s*\*\*[^*\n]+\*\*\s*$/.test(raw) || /^\s*#{1,6}\s+\S.*\s*$/.test(raw))) return ""
  const next = compactThoughtSpacing(body || raw)
  return meaningfulThought(next) ? next : ""
}

export function reasoningVisible(part: ReasoningPart) {
  // Live shells may still be empty while tokens arrive; completed quote-only husks must go.
  if (!Number.isFinite(part.time?.end)) return true
  return Boolean(thinkingBody(part))
}
