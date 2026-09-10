import { createContext, createEffect, createSignal, useContext, type ParentProps } from "solid-js"
import { applyTheme, loadTheme, saveTheme, type Theme } from "../lib/theme"

export type ThemeApi = {
  theme: () => Theme
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeApi>()

export function ThemeProvider(props: ParentProps) {
  const [theme, setThemeSignal] = createSignal<Theme>(loadTheme())

  createEffect(() => applyTheme(theme()))

  const api: ThemeApi = {
    theme,
    setTheme: (next) => {
      setThemeSignal(next)
      saveTheme(next)
    },
  }

  return <ThemeContext.Provider value={api}>{props.children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error("useTheme must be used within ThemeProvider")
  return context
}
