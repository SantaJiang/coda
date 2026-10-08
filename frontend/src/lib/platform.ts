import { isMacPlatform } from "./settings"

export function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

export function isWindowsPlatform() {
  if (typeof navigator === "undefined") return false
  return /Win/i.test(navigator.platform) || /Windows/i.test(navigator.userAgent)
}

/** Windows 启动时窗口是隐藏的，等首屏画完再显示，避免先弹出一块空白。 */
export async function revealMainWindow() {
  if (!isTauri() || !isWindowsPlatform()) return
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window")
    const win = getCurrentWindow()
    await win.show()
    await win.setShadow(true).catch(() => undefined)
    await win.setFocus()
  } catch {
    // 浏览器预览没有窗口句柄；Rust 侧还有超时显示兜底。
  }
}

/** macOS keeps Overlay + system traffic lights; Windows/Linux are frameless. */
export function usesCustomWindowControls() {
  return isTauri() && !isMacPlatform()
}

export function applyWindowChromeAttr() {
  if (typeof document === "undefined") return
  document.documentElement.dataset.chrome = isMacPlatform() ? "overlay" : "frameless"
}
