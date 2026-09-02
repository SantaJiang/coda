import { STORAGE_KEYS } from "./config"

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
  if (event.key !== "Enter" || event.isComposing || event.shiftKey) return false
  const mod = isMacPlatform() ? event.metaKey : event.ctrlKey
  if (shortcut === "enter") return !event.metaKey && !event.ctrlKey && !event.altKey
  return mod && !event.altKey
}

export function loadSendShortcut(): SendShortcut {
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
}
