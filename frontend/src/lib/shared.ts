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
  keepBackendAlive?: boolean
  projects?: Project[]
  lastProject?: string | null
}

export type SharedListener = (patch: SharedSettings) => void

const WRITE_DEBOUNCE_MS = 150

let memory: SharedSettings | null = null
let hydrated = false
let writeTimer: ReturnType<typeof setTimeout> | undefined
// 本地已改、还没写进文件的 key。刷新时不用文件值覆盖它们，
// 写入时只把这些 key 合并进文件，避免整份覆盖掉另一个实例的改动。
const dirty = new Set<keyof SharedSettings>()
const listeners = new Set<SharedListener>()

export function sharedValue<K extends keyof SharedSettings>(key: K): SharedSettings[K] | undefined {
  if (!hydrated) return undefined
  return memory?.[key]
}

export function hasSharedValue(key: keyof SharedSettings) {
  return hydrated && memory !== null && key in memory
}

export function setSharedValue(patch: SharedSettings) {
  memory = { ...(memory ?? {}), ...patch }
  for (const key of Object.keys(patch) as Array<keyof SharedSettings>) dirty.add(key)
  scheduleWrite()
}

export function onSharedChange(listener: SharedListener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
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
  dirty.clear()
  if (result.shouldWrite && memory) {
    for (const key of Object.keys(memory) as Array<keyof SharedSettings>) dirty.add(key)
  }
  installWindowHandlers()
  if (result.shouldWrite) await writeSettingsFile()
}

export async function flushShared() {
  if (writeTimer) {
    clearTimeout(writeTimer)
    writeTimer = undefined
  }
  await writeSettingsFile()
}

// 重新读文件，把其他实例写入的改动合并进内存并通知界面。
export async function refreshShared() {
  if (!hydrated) return
  const file = await readSettingsFile()
  if (!file) return
  const patch: SharedSettings = {}
  for (const key of Object.keys(file) as Array<keyof SharedSettings>) {
    if (dirty.has(key)) continue
    const value = file[key]
    if (JSON.stringify(value) === JSON.stringify(memory?.[key])) continue
    Object.assign(patch, { [key]: value })
  }
  if (Object.keys(patch).length === 0) return
  memory = { ...(memory ?? {}), ...patch }
  for (const listener of [...listeners]) listener(patch)
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

export function mergeForWrite(file: SharedSettings | null, current: SharedSettings, keys: Array<keyof SharedSettings>) {
  if (!file) return { ...current }
  const merged: SharedSettings = { ...file }
  for (const key of keys) {
    if (key in current) Object.assign(merged, { [key]: current[key] })
    else delete merged[key]
  }
  return merged
}

async function writeSettingsFile() {
  if (!memory) return
  const keys = [...dirty]
  if (keys.length === 0) return
  const merged = mergeForWrite(await readSettingsFile(), memory, keys)
  try {
    const ok = await invokeSettings<boolean>("settings_write", { content: JSON.stringify(merged, null, 2) })
    if (ok === false) return
    memory = merged
    for (const key of keys) dirty.delete(key)
  } catch {
    // ignore when the Tauri bridge is unavailable (browser mode)
  }
}

let handlersInstalled = false
function installWindowHandlers() {
  if (handlersInstalled || typeof window === "undefined") return
  handlersInstalled = true
  window.addEventListener("pagehide", () => {
    void flushShared()
  })
  window.addEventListener("focus", () => {
    void refreshShared()
  })
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refreshShared()
  })
}
