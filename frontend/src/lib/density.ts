import { createSignal } from "solid-js"

/** Glass exposes three stops. The other two densities stay available for grouping rules. */
export type ConversationDensity =
  | "detailed"
  | "compact-shells"
  | "compact-ungrouped"
  | "compact-grouped"
  | "compact-all-grouped"

export type DensityChoice = "compact-all-grouped" | "compact-ungrouped" | "detailed"

export const DENSITY_CHOICES: Array<{ id: DensityChoice; label: string }> = [
  { id: "compact-all-grouped", label: "Compact" },
  { id: "compact-ungrouped", label: "Balanced" },
  { id: "detailed", label: "Detailed" },
]

const KEY = "coda.conversationDensity"

function migrate(raw: string | null): ConversationDensity {
  if (raw === "verbose" || raw === "detailed") return "detailed"
  if (raw === "compact-ungrouped" || raw === "compact-shells") return "compact-ungrouped"
  if (raw === "minimal" || raw === "compact-grouped" || raw === "compact-all-grouped") return "compact-all-grouped"
  return "compact-all-grouped"
}

function read(): ConversationDensity {
  try {
    return migrate(localStorage.getItem(KEY))
  } catch {
    return "compact-all-grouped"
  }
}

const [density, setDensity] = createSignal<ConversationDensity>(read())

export function conversationDensity() {
  return density()
}

export function setConversationDensity(value: ConversationDensity) {
  const next = migrate(value)
  setDensity(next)
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // ignore
  }
}
