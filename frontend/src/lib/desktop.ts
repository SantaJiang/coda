import { isTauri } from "./platform"

// A terminal may consume WebView key events before the native menu sees them.
// Keep Cmd+Q on macOS routed through exactly the same native shutdown path.
export function installQuitShortcut() {
  if (!isTauri()) return () => {}
  const quit = (event: KeyboardEvent) => {
    if (!event.metaKey || event.ctrlKey || event.altKey || event.key.toLowerCase() !== "q") return
    if (!/Mac/i.test(navigator.platform)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    void import("@tauri-apps/api/core").then(({ invoke }) => invoke("desktop_quit")).catch(() => undefined)
  }
  window.addEventListener("keydown", quit, true)
  return () => window.removeEventListener("keydown", quit, true)
}

/** 外部链接交给系统浏览器；浏览器预览里退回新标签页。 */
export async function openExternalLink(url: string) {
  if (!isTauri()) {
    window.open(url, "_blank", "noopener,noreferrer")
    return
  }
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener")
    await openUrl(url)
  } catch {
    // 打不开链接不该打断阅读。
  }
}

/**
 * 窗口里只显示 Coda 自带的前端：外链（含会话流里的网址）交给系统浏览器，
 * 其它协议和跨源跳转直接拦下，不让主窗口离开我们的页面。
 */
export function installNavigationGuard() {
  const openable = (protocol: string) => ["http:", "https:", "mailto:", "tel:"].includes(protocol)
  const guard = (event: MouseEvent) => {
    if (event.defaultPrevented) return
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null
    if (!anchor) return
    const href = anchor.getAttribute("href")
    if (!href || href.startsWith("#")) return
    let url: URL
    try {
      url = new URL(anchor.href, document.baseURI)
    } catch {
      event.preventDefault()
      return
    }
    // 导出下载（blob 或 [download]）走浏览器的下载路径，不是页面跳转。
    if (url.protocol === "blob:" || anchor.hasAttribute("download")) return
    // 同源页面是前端自己，放行（SPA 路由用 history API，不会走到这里）。
    if (openable(url.protocol) && url.origin === location.origin) return
    event.preventDefault()
    event.stopPropagation()
    if (openable(url.protocol)) void openExternalLink(url.href)
  }
  document.addEventListener("click", guard, true)
  document.addEventListener("auxclick", guard, true)
  // 只在桌面端接管 window.open；浏览器预览保持原生新标签页行为。
  const originalOpen = window.open
  if (isTauri()) window.open = ((url?: string | URL) => { void openExternalLink(String(url ?? "")); return null }) as typeof window.open
  return () => {
    document.removeEventListener("click", guard, true)
    document.removeEventListener("auxclick", guard, true)
    if (isTauri()) window.open = originalOpen
  }
}

export async function prepareNotifications() {
  if (!isTauri()) return
  try {
    const { isPermissionGranted, requestPermission } = await import("@tauri-apps/plugin-notification")
    const asked = localStorage.getItem("coda.notificationPermissionAsked") === "true"
    if (!(await isPermissionGranted()) && !asked) {
      localStorage.setItem("coda.notificationPermissionAsked", "true")
      await requestPermission()
    }
  } catch {
    /* Notification availability does not affect task execution. */
  }
}
export async function reportDesktopActivity(active: boolean) {
  if (!isTauri()) return
  try {
    const { invoke } = await import("@tauri-apps/api/core")
    await invoke("desktop_activity", { active })
  } catch {}
}

export async function reportCloseBehavior(tray: boolean) {
  if (!isTauri()) return
  try {
    const { invoke } = await import("@tauri-apps/api/core")
    await invoke("desktop_close_behavior", { tray })
  } catch {}
}
