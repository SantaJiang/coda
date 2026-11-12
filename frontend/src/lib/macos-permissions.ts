import { isMacPlatform, isTauri } from "./platform"

export type MacPermissionStatus = {
  supported: boolean
  fullDiskAccess: boolean
  screenRecording: boolean
}

export type MacPermissionPane =
  | "fullDiskAccess"
  | "screenRecording"
  | "filesAndFolders"
  | "desktopFolder"
  | "documentsFolder"
  | "downloadsFolder"

const UNSUPPORTED: MacPermissionStatus = {
  supported: false,
  fullDiskAccess: false,
  screenRecording: false,
}

function available() {
  return isTauri() && isMacPlatform()
}

async function invoke<T>(command: string, args?: Record<string, unknown>) {
  const api = await import("@tauri-apps/api/core")
  return (await api.invoke(command, args)) as T
}

export async function macPermissionStatus(): Promise<MacPermissionStatus> {
  if (!available()) return { ...UNSUPPORTED }
  try {
    const status = await invoke<Partial<MacPermissionStatus>>("macos_permission_status")
    return {
      supported: Boolean(status?.supported),
      fullDiskAccess: Boolean(status?.fullDiskAccess),
      screenRecording: Boolean(status?.screenRecording),
    }
  } catch {
    return { ...UNSUPPORTED }
  }
}

/** Opens System Settings on the privacy pane that contains this permission. */
export async function openMacPermissionSettings(pane: MacPermissionPane): Promise<boolean> {
  if (!available()) return false
  try {
    await invoke("macos_open_permission_settings", { pane })
    return true
  } catch {
    return false
  }
}

/**
 * Asks macOS for Screen Recording access. The first call shows the system
 * consent dialog; later calls only report the current state.
 */
export async function requestMacScreenRecording(): Promise<boolean> {
  if (!available()) return false
  try {
    return Boolean(await invoke<boolean>("macos_request_screen_recording"))
  } catch {
    return false
  }
}

export async function restartCoda(): Promise<void> {
  if (!available()) return
  try {
    await invoke("macos_restart")
  } catch {
    // The process normally exits before the reply arrives.
  }
}