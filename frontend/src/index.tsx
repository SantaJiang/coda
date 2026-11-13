/* @refresh reload */
import { render } from "solid-js/web"
import "virtual:uno.css"
import "./styles/global.css"
import { applyWindowChromeAttr, revealMainWindow } from "./lib/platform"
import { hydrateShared } from "./lib/shared"
import { applyWindowMaterial } from "./lib/window-effects"
import { initTheme, loadTheme, resolveTheme } from "./lib/theme"
import { clearRetiredModelStorage, loadConfiguredModels, loadSelectedModelKey, loadSelectedVariants } from "./lib/models"
import { loadPermissionMode } from "./lib/permissions"
import { clearRetiredBackgroundSetting, loadTaskRecovery, loadStopBehavior, loadSendShortcut } from "./lib/settings"
import { loadLastProject, loadProjects } from "./lib/persist"
import App from "./App"

async function boot() {
  try {
    clearRetiredModelStorage()
    clearRetiredBackgroundSetting()
    try {
      await hydrateShared(() => ({
        models: loadConfiguredModels(),
        selectedModelKey: loadSelectedModelKey(),
        selectedVariants: loadSelectedVariants(),
        theme: loadTheme(),
        sendShortcut: loadSendShortcut(),
        permissionMode: loadPermissionMode(),
        taskRecovery: loadTaskRecovery(),
        stopBehavior: loadStopBehavior(),
        projects: loadProjects(),
        lastProject: loadLastProject(),
      }))
    } catch {
      // keep the localStorage fallbacks when hydration fails
    }
    initTheme()
    applyWindowChromeAttr()
    // 先把原生材质挂上再画首屏，避免实色背景先盖住玻璃/Mica。
    await applyWindowMaterial(resolveTheme(loadTheme()))
    render(() => <App />, document.getElementById("root") as HTMLElement)
  } finally {
    await revealMainWindow()
  }
}

void boot()
