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
