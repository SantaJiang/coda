import { saveSendShortcut, type SendShortcut } from "../lib/settings"
import { permissionPreset, savePermissionMode, type PermissionMode } from "../lib/permissions"
import { popoverPatch } from "./state"
import type { ChromeApi } from "./contracts"
import { activePlanMode, reportError, selectedProjectOf, selectedSessionOf, type StoreHandle } from "./handle"
import { applySessionPermission, autoReplyPending } from "./permission-sync"

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
    planPanelDismissed: () => state.planPanelDismissed,
    setPlanMode: (on) => {
      const id = state.selectedSessionId
      if (id) setState("planModeBySession", id, on)
      else setState("draftPlanMode", on)
      setState("plusMenuOpen", false)
    },
    openPlusMenu: () => setState(popoverPatch("plus")),
    closePlusMenu: () => setState("plusMenuOpen", false),
    openPermissionMenu: () => setState(popoverPatch("permission")),
    closePermissionMenu: () => setState("permissionMenuOpen", false),
    setPermissionMode: async (mode: PermissionMode) => {
      setState({ permissionMode: mode, permissionMenuOpen: false })
      savePermissionMode(mode)
      const session = selectedSessionOf(state)
      const project = selectedProjectOf(state)
      if (session && project) {
        try {
          await applySessionPermission(handle, project.path, session.id, mode)
          await autoReplyPending(handle, mode, session.id)
        } catch (error) {
          reportError(handle, error, "更新权限失败")
        }
      }
    },
    closePlanPanel: () => setState("planPanelDismissed", true),
    openSettings: () => setState({ settingsOpen: true, ...popoverPatch(null) }),
    closeSettings: () => setState("settingsOpen", false),
    setSendShortcut: (shortcut: SendShortcut) => {
      setState("sendShortcut", shortcut)
      saveSendShortcut(shortcut)
    },
  }
}
