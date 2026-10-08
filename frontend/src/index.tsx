/* @refresh reload */
import { render } from "solid-js/web"
import "virtual:uno.css"
import "./styles/global.css"
import { applyWindowChromeAttr, revealMainWindow } from "./lib/platform"
import { hydrateShared } from "./lib/shared"
import { initTheme, loadTheme } from "./lib/theme"
import { clearRetiredModelStorage, loadConfiguredModels, loadSelectedModelKey } from "./lib/models"
import { loadPermissionMode } from "./lib/permissions"
import { loadKeepBackendAlive, loadSendShortcut } from "./lib/settings"
import { loadLastProject, loadProjects } from "./lib/persist"
import App from "./App"

async function boot() {
  try {
    clearRetiredModelStorage()
    try {
      await hydrateShared(() => ({
        models: loadConfiguredModels(),
        selectedModelKey: loadSelectedModelKey(),
        theme: loadTheme(),
        sendShortcut: loadSendShortcut(),
        permissionMode: loadPermissionMode(),
        keepBackendAlive: loadKeepBackendAlive(),
        projects: loadProjects(),
        lastProject: loadLastProject(),
      }))
    } catch {
      // keep the localStorage fallbacks when hydration fails
    }
    initTheme()
    applyWindowChromeAttr()
    render(() => <App />, document.getElementById("root") as HTMLElement)
  } finally {
    await revealMainWindow()
  }
}

void boot()
