import { saveKeepBackendAlive, saveSendShortcut, type SendShortcut } from "../lib/settings"
import { permissionPreset, savePermissionMode, type PermissionMode } from "../lib/permissions"
import { isLocalDraft } from "../lib/draft-session"
import { popoverPatch } from "./state"
import type { ChromeApi } from "./contracts"
import { persistDraftSessions } from "./draft-session-state"
import { activePlanMode, reportError, selectedSessionOf, type StoreHandle } from "./handle"
import { pushPermissionMode } from "./permission-sync"

export function createChromeSlice(handle: StoreHandle): ChromeApi {
  const { state, setState } = handle

  return {
    overlayOpen: () =>
      state.settingsOpen ||
      state.modelSettingsOpen ||
      state.modelMenuOpen ||
      state.plusMenuOpen ||
      state.variantMenuOpen ||
      state.permissionMenuOpen,
    planMode: () => activePlanMode(state),
    plusMenuOpen: () => state.plusMenuOpen,
    permissionMenuOpen: () => state.permissionMenuOpen,
    permissionMode: () => state.permissionMode,
    permissionLabel: () => permissionPreset(state.permissionMode).label,
    settingsOpen: () => state.settingsOpen,
    sendShortcut: () => state.sendShortcut,
    keepBackendAlive: () => state.keepBackendAlive,
    planPanelDismissed: () => state.planPanelDismissed,
    setPlanMode: (on) => {
      const id = state.selectedSessionId
      if (id) setState("planModeBySession", id, on)
      else setState("draftPlanMode", on)
      setState("plusMenuOpen", false)
      if (isLocalDraft(selectedSessionOf(state))) persistDraftSessions(handle)
    },
    openPlusMenu: () => setState(popoverPatch("plus")),
    closePlusMenu: () => setState("plusMenuOpen", false),
    openPermissionMenu: () => setState(popoverPatch("permission")),
    closePermissionMenu: () => setState("permissionMenuOpen", false),
    setPermissionMode: async (mode: PermissionMode) => {
      setState({ permissionMode: mode, permissionMenuOpen: false })
      savePermissionMode(mode)
      try {
        await pushPermissionMode(handle, mode)
      } catch (error) {
        reportError(handle, error, "更新权限失败")
      }
    },
    closePlanPanel: () => setState("planPanelDismissed", true),
    openSettings: () => setState({ settingsOpen: true, ...popoverPatch(null) }),
    closeSettings: () => setState("settingsOpen", false),
    setSendShortcut: (shortcut: SendShortcut) => {
      setState("sendShortcut", shortcut)
      saveSendShortcut(shortcut)
    },
    setKeepBackendAlive: (value: boolean) => {
      setState("keepBackendAlive", value)
      saveKeepBackendAlive(value)
    },
  }
}
