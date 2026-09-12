import { createContext, createEffect, createSignal, onCleanup, useContext, type ParentProps } from "solid-js"
import { onSharedChange } from "../lib/shared"
import { applyTheme, isTheme, loadTheme, saveTheme, type Theme } from "../lib/theme"

export type ThemeApi = {
  theme: () => Theme
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeApi>()

export function ThemeProvider(props: ParentProps) {
  const [theme, setThemeSignal] = createSignal<Theme>(loadTheme())

  createEffect(() => applyTheme(theme()))

  // 其他实例（run.sh 开发版 / 安装版）改了主题时跟随更新
  const unsubscribe = onSharedChange((patch) => {
    if (isTheme(patch.theme) && patch.theme !== theme()) setThemeSignal(patch.theme)
  })
  onCleanup(unsubscribe)

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
