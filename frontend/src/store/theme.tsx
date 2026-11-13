import { createContext, createEffect, createSignal, onCleanup, useContext, type ParentProps } from "solid-js"
import { onSharedChange } from "../lib/shared"
import { applyWindowMaterial } from "../lib/window-effects"
import {
  applyTheme,
  isTheme,
  loadTheme,
  resolveTheme,
  saveTheme,
  systemTheme,
  watchSystemTheme,
  type ResolvedTheme,
  type Theme,
} from "../lib/theme"

export type ThemeApi = {
  /** 用户选择的偏好，可能是 system。 */
  theme: () => Theme
  /** 当前实际生效的浅色/深色，已把 system 解析掉。 */
  resolvedTheme: () => ResolvedTheme
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeApi>()

export function ThemeProvider(props: ParentProps) {
  const [theme, setThemeSignal] = createSignal<Theme>(loadTheme())
  const [system, setSystem] = createSignal<ResolvedTheme>(systemTheme())
  const resolvedTheme = () => resolveTheme(theme(), system())

  createEffect(() => {
    const resolved = resolvedTheme()
    applyTheme(resolved)
    void applyWindowMaterial(resolved)
  })

  const stopWatchingSystem = watchSystemTheme(setSystem)
  onCleanup(stopWatchingSystem)

  // 其他实例（run.sh 开发版 / 安装版）改了主题时跟随更新
  const unsubscribe = onSharedChange((patch) => {
    if (isTheme(patch.theme) && patch.theme !== theme()) setThemeSignal(patch.theme)
  })
  onCleanup(unsubscribe)

  const api: ThemeApi = {
    theme,
    resolvedTheme,
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
