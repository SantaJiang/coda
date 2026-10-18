import type { ConfiguredModel } from "./models"
import type { PermissionMode } from "./permissions"
import type { SendShortcut, TaskRecovery, StopBehavior, CloseBehavior } from "./settings"
import type { Theme } from "./theme"
import type { Project } from "./types"

export type SharedSettings = {
  models?: ConfiguredModel[]
  selectedModelKey?: string | null
  theme?: Theme
  sendShortcut?: SendShortcut
  permissionMode?: PermissionMode
  taskRecovery?: TaskRecovery
  stopBehavior?: StopBehavior
  closeBehavior?: CloseBehavior
  projects?: Project[]
  lastProject?: string | null
}

export type SharedListener = (patch: SharedSettings) => void

const WRITE_DEBOUNCE_MS = 150

let memory: SharedSettings | null = null
let hydrated = false
let retiredDetected = false
let writeError: string | null = null
let retryCount = 0
export const sharedWriteError = () => writeError
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
  return { memory: { ...seed, ...stripRetiredSettings(file) }, shouldWrite: "keepBackendAlive" in file }
}

export async function hydrateShared(seed: () => SharedSettings) {
  const result = mergeHydrated(await readSettingsFile(), seed())
  memory = result.memory
  hydrated = true
  dirty.clear()
  installWindowHandlers()
  if ((result.shouldWrite || retiredDetected) && memory) {
    for (const key of Object.keys(memory) as Array<keyof SharedSettings>) dirty.add(key)
    await writeSettingsFile(true)
  }
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

async function invokeSettings<T>(cmd: "settings_read" | "settings_patch", args?: Record<string, unknown>) {
  const { invoke } = await import("@tauri-apps/api/core")
  return (await invoke(cmd, args)) as T
}

async function readSettingsFile(): Promise<SharedSettings | null> {
  try {
    const raw = await invokeSettings<string | null>("settings_read")
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === "object" && "keepBackendAlive" in parsed) retiredDetected = true
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? stripRetiredSettings(parsed as SharedSettings)
      : null
  } catch {
    return null
  }
}

// 已下线的字段：不再读写 pinned 模型。读文件时统一剔除，
// 避免老 settings.json 里的残留键被合并回内存又写回文件。
export function stripRetiredSettings(settings: SharedSettings) {
  const {
    pinnedModelKeys: _retired,
    keepBackendAlive: _background,
    ...rest
  } = settings as SharedSettings & { pinnedModelKeys?: string[]; keepBackendAlive?: boolean }
  return rest
}

function scheduleWrite() {
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(() => {
    writeTimer = undefined
    void writeSettingsFile()
  }, WRITE_DEBOUNCE_MS)
}

let writeQueue: Promise<void> = Promise.resolve()

function writeSettingsFile(onlyMissing = false) {
  const run = writeQueue.then(() => performWrite(onlyMissing))
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function performWrite(onlyMissing = false) {
  if (!memory || dirty.size === 0) return
  const snapshot = memory
  const keys = [...dirty]
  const patch = Object.fromEntries(keys.map((key) => [key, snapshot[key]]))
  try {
    const merged = await invokeSettings<SharedSettings>("settings_patch", { patch, onlyMissing })
    retryCount = 0
    if (writeError) {
      writeError = null
      window.dispatchEvent(new CustomEvent("coda:settings-error", { detail: "" }))
    }
    if (memory === snapshot) {
      const external: SharedSettings = {}
      for (const key of Object.keys(merged) as Array<keyof SharedSettings>) {
        if (!keys.includes(key) && JSON.stringify(snapshot[key]) !== JSON.stringify(merged[key]))
          Object.assign(external, { [key]: merged[key] })
      }
      memory = merged
      for (const key of keys) dirty.delete(key)
      if (Object.keys(external).length) for (const listener of [...listeners]) listener(external)
      return
    }
    for (const key of keys) {
      if (memory[key] === snapshot[key]) dirty.delete(key)
    }
  } catch (error) {
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      writeError = error instanceof Error ? error.message : String(error)
      window.dispatchEvent(new CustomEvent("coda:settings-error", { detail: writeError }))
      if (!writeTimer)
        writeTimer = setTimeout(
          () => {
            writeTimer = undefined
            void writeSettingsFile()
          },
          Math.min(30_000, 1000 * 2 ** Math.min(retryCount++, 5)),
        )
    }
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
