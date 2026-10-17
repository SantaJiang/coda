import { STORAGE_KEYS } from "./config"
import { flushShared, setSharedValue, sharedValue } from "./shared"

export type SendShortcut = "enter" | "mod-enter"

const VALUES = new Set<SendShortcut>(["enter", "mod-enter"])

export function isMacPlatform() {
  if (typeof navigator === "undefined") return false
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform) || /Mac OS X/i.test(navigator.userAgent)
}

export function modifierLabel() {
  return isMacPlatform() ? "Cmd" : "Ctrl"
}

export function sendShortcutLabel(shortcut: SendShortcut) {
  return shortcut === "enter" ? "Enter" : `${modifierLabel()}+Enter`
}

export function isSendHotkey(event: KeyboardEvent, shortcut: SendShortcut) {
  if (event.key !== "Enter" || event.isComposing || event.altKey) return false
  const modded = event.metaKey || event.ctrlKey
  return shortcut === "mod-enter" ? modded : !modded
}

export function isNewlineHotkey(event: KeyboardEvent, shortcut: SendShortcut) {
  if (shortcut !== "enter") return false
  if (event.key !== "Enter" || event.isComposing || event.altKey) return false
  return event.metaKey || event.ctrlKey
}

export function loadSendShortcut(): SendShortcut {
  const shared = sharedValue("sendShortcut")
  if (shared && VALUES.has(shared)) return shared
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.sendShortcut)
    if (raw && VALUES.has(raw as SendShortcut)) return raw as SendShortcut
  } catch {
    // ignore
  }
  return "enter"
}

export function saveSendShortcut(value: SendShortcut) {
  localStorage.setItem(STORAGE_KEYS.sendShortcut, value)
  setSharedValue({ sendShortcut: value })
}

export type TaskRecovery = "auto" | "manual"
export type StopBehavior = "all" | "ai"
export function loadTaskRecovery(): TaskRecovery { return sharedValue("taskRecovery") === "manual" ? "manual" : "auto" }
export function loadStopBehavior(): StopBehavior { return sharedValue("stopBehavior") === "ai" ? "ai" : "all" }
export function saveTaskRecovery(value: TaskRecovery) { setSharedValue({ taskRecovery: value }); void flushShared() }
export function saveStopBehavior(value: StopBehavior) { setSharedValue({ stopBehavior: value }); void flushShared() }
export function clearRetiredBackgroundSetting() {
  try { localStorage.removeItem("coda.keepBackendAlive") } catch {}
}
