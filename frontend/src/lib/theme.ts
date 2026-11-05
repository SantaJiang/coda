import { STORAGE_KEYS } from "./config"
import { setSharedValue, sharedValue } from "./shared"

/** 用户选择的主题偏好；system 表示跟随系统外观。 */
export type Theme = "system" | "light" | "dark"

/** 实际落到界面上的主题。 */
export type ResolvedTheme = "light" | "dark"

export const DEFAULT_THEME: Theme = "dark"

const THEME_COLORS: Record<ResolvedTheme, string> = {
  dark: "#1e1e20",
  light: "#fafafa",
}

export function isTheme(value: unknown): value is Theme {
  return value === "system" || value === "light" || value === "dark"
}

export function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "dark"
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  } catch {
    return "dark"
  }
}

export function resolveTheme(theme: Theme, system?: ResolvedTheme): ResolvedTheme {
  return theme === "system" ? (system ?? systemTheme()) : theme
}

/** 订阅系统外观变化；返回取消订阅函数。 */
export function watchSystemTheme(listener: (theme: ResolvedTheme) => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {}
  const media = window.matchMedia("(prefers-color-scheme: dark)")
  const onChange = () => listener(media.matches ? "dark" : "light")
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }
  // 老版 WebKit 只有 addListener/removeListener。
  media.addListener(onChange)
  return () => media.removeListener(onChange)
}

export function loadTheme(): Theme {
  const shared = sharedValue("theme")
  if (isTheme(shared)) return shared
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.theme)
    if (isTheme(raw)) return raw
  } catch {
    // ignore: storage unavailable (private mode)
  }
  return DEFAULT_THEME
}

export function saveTheme(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEYS.theme, theme)
  } catch {
    // ignore
  }
  setSharedValue({ theme })
}

export function applyTheme(theme: Theme, root?: HTMLElement | null) {
  const target = root ?? (typeof document === "undefined" ? null : document.documentElement)
  if (!target) return
  const resolved = resolveTheme(theme)
  target.dataset.theme = resolved
  if (typeof document === "undefined") return
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta) meta.content = THEME_COLORS[resolved]
}

export function initTheme(theme: Theme = loadTheme()) {
  applyTheme(theme)
}
