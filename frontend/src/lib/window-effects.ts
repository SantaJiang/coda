import { isTauri } from "./platform-detect"
import type { ResolvedTheme } from "./theme"

/** What the OS actually gave the window; the CSS keys off this value. */
export type WindowMaterial = "glass" | "mica" | "solid"

const MATERIALS: readonly string[] = ["glass", "mica", "solid"]

export function isWindowMaterial(value: unknown): value is WindowMaterial {
  return typeof value === "string" && MATERIALS.includes(value)
}

export function markWindowMaterial(material: WindowMaterial, root?: HTMLElement | null) {
  const target = root ?? (typeof document === "undefined" ? null : document.documentElement)
  if (target) target.dataset.windowMaterial = material
}

// boot() 和 ThemeProvider 的首次 effect 会各请求一次；同一主题只下发一次，
// 避免 macOS 上 clear + re-apply 造成一次可见的闪动。
let lastApplied: { theme: ResolvedTheme; material: WindowMaterial } | null = null

/** Ask the Rust side for a native backdrop; fall back to the solid palette. */
export async function applyWindowMaterial(theme: ResolvedTheme): Promise<WindowMaterial> {
  if (lastApplied?.theme === theme) return lastApplied.material

  if (!isTauri()) {
    markWindowMaterial("solid")
    lastApplied = { theme, material: "solid" }
    return "solid"
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core")
    const value = await invoke<string>("window_material", { theme })
    const material = isWindowMaterial(value) ? value : "solid"
    markWindowMaterial(material)
    lastApplied = { theme, material }
    return material
  } catch {
    markWindowMaterial("solid")
    lastApplied = { theme, material: "solid" }
    return "solid"
  }
}
