import { STORAGE_KEYS } from "./config"

export type Theme = "light" | "dark"

export const DEFAULT_THEME: Theme = "dark"

const THEME_COLORS: Record<Theme, string> = {
  dark: "#1e1e20",
  light: "#fafafa",
}

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark"
}

export function loadTheme(): Theme {
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
}

export function applyTheme(theme: Theme, root?: HTMLElement | null) {
  const target = root ?? (typeof document === "undefined" ? null : document.documentElement)
  if (!target) return
  target.dataset.theme = theme
  if (typeof document === "undefined") return
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta) meta.content = THEME_COLORS[theme]
}

export function initTheme(theme: Theme = loadTheme()) {
  applyTheme(theme)
}
