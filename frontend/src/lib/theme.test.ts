import { afterEach, describe, expect, it, vi } from "vitest"
import { STORAGE_KEYS } from "./config"
import {
  applyTheme,
  DEFAULT_THEME,
  initTheme,
  isTheme,
  loadTheme,
  resolveTheme,
  saveTheme,
  watchSystemTheme,
  type ResolvedTheme,
} from "./theme"

function mockSystem(initialDark: boolean) {
  const listeners = new Set<() => void>()
  const media = {
    matches: initialDark,
    addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
  }
  vi.stubGlobal("matchMedia", () => media)
  return {
    setDark(dark: boolean) {
      media.matches = dark
      for (const listener of [...listeners]) listener()
    },
  }
}

describe("theme", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  it("validates themes", () => {
    expect(isTheme("light")).toBe(true)
    expect(isTheme("dark")).toBe(true)
    expect(isTheme("system")).toBe(true)
    expect(isTheme("sepia")).toBe(false)
    expect(isTheme(null)).toBe(false)
  })

  it("defaults to dark and persists a theme preference", () => {
    expect(DEFAULT_THEME).toBe("dark")
    expect(loadTheme()).toBe("dark")
    saveTheme("light")
    expect(localStorage.getItem(STORAGE_KEYS.theme)).toBe("light")
    expect(loadTheme()).toBe("light")
    saveTheme("system")
    expect(localStorage.getItem(STORAGE_KEYS.theme)).toBe("system")
    expect(loadTheme()).toBe("system")
  })

  it("ignores invalid stored values", () => {
    localStorage.setItem(STORAGE_KEYS.theme, "sepia")
    expect(loadTheme()).toBe("dark")
  })

  it("resolves the system preference from the media query", () => {
    const system = mockSystem(true)
    expect(resolveTheme("system")).toBe("dark")
    system.setDark(false)
    expect(resolveTheme("system")).toBe("light")
    expect(resolveTheme("light")).toBe("light")
    expect(resolveTheme("dark")).toBe("dark")
  })

  it("applies the theme to the document", () => {
    const meta = document.createElement("meta")
    meta.name = "theme-color"
    document.head.appendChild(meta)

    applyTheme("light")
    expect(document.documentElement.dataset.theme).toBe("light")
    expect(meta.content).toBe("#fafafa")

    applyTheme("dark")
    expect(document.documentElement.dataset.theme).toBe("dark")
    expect(meta.content).toBe("#1e1e20")

    meta.remove()
  })

  it("applies the resolved system theme", () => {
    const system = mockSystem(true)
    applyTheme("system")
    expect(document.documentElement.dataset.theme).toBe("dark")
    system.setDark(false)
    applyTheme("system")
    expect(document.documentElement.dataset.theme).toBe("light")
  })

  it("notifies and unsubscribes on system theme changes", () => {
    const system = mockSystem(true)
    const seen: ResolvedTheme[] = []
    const stop = watchSystemTheme((theme) => seen.push(theme))
    system.setDark(false)
    stop()
    system.setDark(true)
    expect(seen).toEqual(["light"])
  })

  it("initializes from the stored theme", () => {
    saveTheme("light")
    initTheme()
    expect(document.documentElement.dataset.theme).toBe("light")
  })
})
