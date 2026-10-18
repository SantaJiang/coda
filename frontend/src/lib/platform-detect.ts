export function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

export function isMacPlatform() {
  if (typeof navigator === "undefined") return false
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform) || /Mac OS X/i.test(navigator.userAgent)
}
