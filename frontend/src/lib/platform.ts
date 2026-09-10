import { isMacPlatform } from "./settings"

export function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

/** macOS keeps Overlay + system traffic lights; Windows/Linux are frameless. */
export function usesCustomWindowControls() {
  return isTauri() && !isMacPlatform()
}

export function applyWindowChromeAttr() {
  if (typeof document === "undefined") return
  document.documentElement.dataset.chrome = isMacPlatform() ? "overlay" : "frameless"
}
