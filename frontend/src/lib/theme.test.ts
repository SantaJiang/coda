import { afterEach, describe, expect, it } from "vitest"
import { STORAGE_KEYS } from "./config"
import { applyTheme, DEFAULT_THEME, initTheme, isTheme, loadTheme, saveTheme } from "./theme"

describe("theme", () => {
  afterEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  it("validates themes", () => {
    expect(isTheme("light")).toBe(true)
    expect(isTheme("dark")).toBe(true)
    expect(isTheme("system")).toBe(false)
    expect(isTheme("sepia")).toBe(false)
    expect(isTheme(null)).toBe(false)
  })

  it("defaults to dark and persists a theme", () => {
    expect(DEFAULT_THEME).toBe("dark")
    expect(loadTheme()).toBe("dark")
    saveTheme("light")
    expect(localStorage.getItem(STORAGE_KEYS.theme)).toBe("light")
    expect(loadTheme()).toBe("light")
  })

  it("ignores invalid stored values", () => {
    localStorage.setItem(STORAGE_KEYS.theme, "system")
    expect(loadTheme()).toBe("dark")
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

  it("initializes from the stored theme", () => {
    saveTheme("light")
    initTheme()
    expect(document.documentElement.dataset.theme).toBe("light")
  })
})
