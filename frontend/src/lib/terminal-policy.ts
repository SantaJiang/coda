// Promote a command only after it has sustained execution for this long.
export const LONG_TERMINAL_MS = 10_000

/** Countdown to the next shell check, never a command completion estimate. */
export function shellWaitLabel(remainingMs: number) {
  const seconds = Number.isFinite(remainingMs) ? Math.max(0, Math.ceil(remainingMs / 1000)) : 0
  return `Waiting up to ${Math.floor(seconds / 60)}m ${seconds % 60}s for shell`
}
