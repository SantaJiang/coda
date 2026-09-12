import type { ConfiguredModel } from "./models"
import type { PermissionMode } from "./permissions"
import type { SendShortcut } from "./settings"
import type { Theme } from "./theme"
import type { Project } from "./types"

export type SharedSettings = {
  models?: ConfiguredModel[]
  selectedModelKey?: string | null
  pinnedModelKeys?: string[]
  theme?: Theme
  sendShortcut?: SendShortcut
  permissionMode?: PermissionMode
  projects?: Project[]
  lastProject?: string | null
}

const WRITE_DEBOUNCE_MS = 150

let memory: SharedSettings | null = null
let hydrated = false
let writeTimer: ReturnType<typeof setTimeout> | undefined

export function sharedValue<K extends keyof SharedSettings>(key: K): SharedSettings[K] | undefined {
  if (!hydrated) return undefined
  return memory?.[key]
}

export function hasSharedValue(key: keyof SharedSettings) {
  return hydrated && memory !== null && key in memory
}

export function setSharedValue(patch: SharedSettings) {
  memory = { ...(memory ?? {}), ...patch }
  scheduleWrite()
}

export function mergeHydrated(file: SharedSettings | null, seed: SharedSettings) {
  if (!file) {
    const hasContent = (seed.models?.length ?? 0) > 0 || (seed.projects?.length ?? 0) > 0
    return { memory: hasContent ? seed : null, shouldWrite: hasContent }
  }
  return { memory: { ...seed, ...file }, shouldWrite: false }
}

export async function hydrateShared(seed: () => SharedSettings) {
  const result = mergeHydrated(await readSettingsFile(), seed())
  memory = result.memory
  hydrated = true
  installFlushHandler()
  if (result.shouldWrite) await writeSettingsFile()
}

async function invokeSettings<T>(cmd: "settings_read" | "settings_write", args?: Record<string, unknown>) {
  const { invoke } = await import("@tauri-apps/api/core")
  return (await invoke(cmd, args)) as T
}

async function readSettingsFile(): Promise<SharedSettings | null> {
  try {
    const raw = await invokeSettings<string | null>("settings_read")
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === "object" ? (parsed as SharedSettings) : null
  } catch {
    return null
  }
}

function scheduleWrite() {
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(() => {
    writeTimer = undefined
    void writeSettingsFile()
  }, WRITE_DEBOUNCE_MS)
}

async function writeSettingsFile() {
  if (!memory) return
  try {
    await invokeSettings("settings_write", { content: JSON.stringify(memory, null, 2) })
  } catch {
    // ignore when the Tauri bridge is unavailable (browser mode)
  }
}

let flushInstalled = false
function installFlushHandler() {
  if (flushInstalled || typeof window === "undefined") return
  flushInstalled = true
  window.addEventListener("pagehide", () => {
    if (writeTimer) {
      clearTimeout(writeTimer)
      writeTimer = undefined
    }
    void writeSettingsFile()
  })
}
