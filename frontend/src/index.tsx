/* @refresh reload */
import { render } from "solid-js/web"
import "virtual:uno.css"
import "./styles/global.css"
import { applyWindowChromeAttr } from "./lib/platform"
import { hydrateShared } from "./lib/shared"
import { initTheme, loadTheme } from "./lib/theme"
import { loadConfiguredModels, loadPinnedModelKeys, loadSelectedModelKey } from "./lib/models"
import { loadPermissionMode } from "./lib/permissions"
import { loadKeepBackendAlive, loadSendShortcut } from "./lib/settings"
import { loadLastProject, loadProjects } from "./lib/persist"
import App from "./App"

async function boot() {
  try {
    await hydrateShared(() => ({
      models: loadConfiguredModels(),
      selectedModelKey: loadSelectedModelKey(),
      pinnedModelKeys: loadPinnedModelKeys(),
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
}

void boot()
