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

export function loadKeepBackendAlive(): boolean {
  const shared = sharedValue("keepBackendAlive")
  if (typeof shared === "boolean") return shared
  try {
    return localStorage.getItem(STORAGE_KEYS.keepBackendAlive) === "true"
  } catch {
    return false
  }
}

export function saveKeepBackendAlive(value: boolean) {
  try {
    localStorage.setItem(STORAGE_KEYS.keepBackendAlive, String(value))
  } catch {
    // ignore
  }
  setSharedValue({ keepBackendAlive: value })
  // 退出前必须落盘：Rust 侧退出时直接读 settings.json 决定是否停后端
  void flushShared()
}
