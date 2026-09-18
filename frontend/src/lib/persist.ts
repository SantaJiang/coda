import { STORAGE_KEYS } from "./config"
import { basename, isWithinPath, parentSegments, samePath } from "./path"
import { hasSharedValue, setSharedValue, sharedValue } from "./shared"
import { uid } from "./uid"
import type { BackendProject, Project, Session } from "./types"

export const LOCAL_PROJECT_ID = "prj_local"
export const LOCAL_PROJECT_NAME = "本机"

// 后端把所有非 git 目录都归到同一个 "global" 项目里，scope=project 会把
// 其他目录的会话一起带回来，所以 global 会话必须再按目录归属过滤一次。
export const GLOBAL_BACKEND_PROJECT_ID = "global"

export function sessionBelongsToProject(session: Session, projectPath: string) {
  if (session.projectID && session.projectID !== GLOBAL_BACKEND_PROJECT_ID) return true
  return isWithinPath(session.directory ?? "", projectPath)
}

export function filterProjectSessions(sessions: Session[], projectPath: string) {
  return sessions.filter((session) => sessionBelongsToProject(session, projectPath))
}

export { basename, samePath } from "./path"

export type ProjectDisplay = {
  name: string
  hint?: string
}

export function projectDisplay(project: Project, all: Project[]): ProjectDisplay {
  const name = isLocalProject(project) ? LOCAL_PROJECT_NAME : project.name?.trim() || basename(project.path)
  if (isLocalProject(project)) return { name }

  const key = name.toLowerCase()
  const collisions = all.filter(
    (item) => !isLocalProject(item) && (item.name || basename(item.path)).toLowerCase() === key,
  )
  if (collisions.length < 2) return { name }

  for (let depth = 1; depth <= 4; depth++) {
    const hints = collisions.map((item) => parentSegments(item.path, depth))
    if (hints.every(Boolean) && new Set(hints).size === hints.length) {
      return { name, hint: parentSegments(project.path, depth) }
    }
  }

  const fallback = parentSegments(project.path, 2) || parentSegments(project.path, 1)
  return fallback ? { name, hint: fallback } : { name }
}

export function projectContextLabel(project: Project, all: Project[]) {
  const { name, hint } = projectDisplay(project, all)
  if (hint) return `${name} · ${hint}`
  return name
}

export function isLocalProject(project: Project | undefined | null): boolean {
  return !!project && (project.kind === "local" || project.id === LOCAL_PROJECT_ID)
}

export function createLocalProject(home: string, expanded = true): Project {
  return {
    id: LOCAL_PROJECT_ID,
    path: home,
    name: LOCAL_PROJECT_NAME,
    expanded,
    kind: "local",
  }
}

export function ensureLocalProject(projects: Project[], home: string): Project[] {
  const previous = projects.find(isLocalProject)
  const local = createLocalProject(home, previous?.expanded ?? true)
  const rest = projects.filter((project) => !isLocalProject(project) && !samePath(project.path, home))
  return [local, ...rest]
}

export function hydrateProjects(stored: Project[], home?: string | null): Project[] {
  if (home) return ensureLocalProject(stored, home)
  const existing = stored.find(isLocalProject)
  if (existing?.path) return ensureLocalProject(stored, existing.path)
  return stored
}

export function pickSelectedProjectId(projects: Project[], last: string | null) {
  if (last && projects.some((project) => project.id === last)) return last
  return projects.find(isLocalProject)?.id ?? projects[0]?.id ?? null
}

export async function resolveHomeDir(): Promise<string | null> {
  try {
    const { homeDir } = await import("@tauri-apps/api/path")
    const home = await homeDir()
    if (typeof home === "string" && home.trim()) return home
  } catch {
    // browser / non-Tauri
  }
  try {
    const { fetchHomeDir } = await import("./api")
    return await fetchHomeDir()
  } catch {
    return null
  }
}

export function loadProjects(): Project[] {
  const shared = sharedValue("projects")
  if (Array.isArray(shared)) return shared
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.projects)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Project[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveProjects(projects: Project[]) {
  const stored = projects.map((project) => {
    const next = { ...project }
    delete next.missing
    return next
  })
  localStorage.setItem(STORAGE_KEYS.projects, JSON.stringify(stored))
  setSharedValue({ projects: stored })
}

export function loadProjectSessions(projectId: string): Session[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.projectSessions)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Record<string, Session[]>
    const list = parsed?.[projectId]
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function saveProjectSessions(projectId: string, sessions: Session[]) {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.projectSessions)
    const parsed = raw ? (JSON.parse(raw) as Record<string, Session[]>) : {}
    const next = parsed && typeof parsed === "object" ? parsed : {}
    next[projectId] = sessions
    localStorage.setItem(STORAGE_KEYS.projectSessions, JSON.stringify(next))
  } catch {
    // ignore quota / private mode
  }
}

export function clearProjectSessions(projectId: string) {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.projectSessions)
    if (!raw) return
    const parsed = JSON.parse(raw) as Record<string, Session[]>
    if (!parsed || typeof parsed !== "object") return
    delete parsed[projectId]
    localStorage.setItem(STORAGE_KEYS.projectSessions, JSON.stringify(parsed))
  } catch {
    // ignore
  }
}

export const MISSING_DIRECTORY_HINT =
  "项目文件夹已不存在（可能被移动或删除）。请在侧栏该项目菜单里选择「重新定位」。"

export function parseMissingDirectory(message: string): string | undefined {
  const realPath = message.match(/FileSystem\.realPath\s*\(([^)]+)\)/)
  if (realPath?.[1]) return realPath[1].trim()
  return message.match(/ENOENT: no such file or directory, lstat '([^']+)'/)?.[1]
}

export function missingDirectoryMessage(message: string): string | undefined {
  if (!/FileSystem\.realPath|ENOENT: no such file or directory/.test(message)) return
  return MISSING_DIRECTORY_HINT
}

export async function directoryExists(path: string): Promise<boolean | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core")
    return await invoke<boolean>("path_exists", { path })
  } catch {
    return null
  }
}

export function loadLastProject() {
  if (hasSharedValue("lastProject")) return sharedValue("lastProject") ?? null
  return localStorage.getItem(STORAGE_KEYS.lastProject)
}

export function saveLastProject(id: string) {
  localStorage.setItem(STORAGE_KEYS.lastProject, id)
  setSharedValue({ lastProject: id })
}

export function createProject(path: string): Project {
  return {
    id: uid("prj"),
    path,
    name: basename(path),
    expanded: true,
  }
}

export function restoreCandidates(projects: Project[], backend: BackendProject[]): string[][] {
  const known = projects.map((project) => project.path)
  const sorted = [...backend].sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))
  const groups: string[][] = []
  for (const item of sorted) {
    const dirs = [item.worktree, ...(item.sandboxes ?? [])].filter(
      (dir, index, all) => dir && dir !== "/" && all.indexOf(dir) === index,
    )
    if (!dirs.length) continue
    if (dirs.some((dir) => known.some((path) => samePath(path, dir)))) continue
    known.push(...dirs)
    groups.push(dirs)
  }
  return groups
}

export async function pickDirectory(): Promise<string | null> {
  try {
    const dialog = await import("@tauri-apps/plugin-dialog")
    const selected = await dialog.open({
      directory: true,
      multiple: false,
      title: "选择项目文件夹",
    })
    if (typeof selected === "string" && selected) return selected
    return null
  } catch {
    const fallback = window.prompt("输入项目文件夹的绝对路径")
    return fallback?.trim() || null
  }
}

export function pickBrowserFiles(options?: { directory?: boolean }) {
  return new Promise<File[]>((resolve) => {
    const input = document.createElement("input")
    input.type = "file"
    input.multiple = !options?.directory
    if (options?.directory) input.setAttribute("webkitdirectory", "")
    else input.multiple = true
    input.addEventListener("change", () => {
      resolve(Array.from(input.files ?? []))
    })
    input.addEventListener("cancel", () => resolve([]))
    input.click()
  })
}

export async function pickFiles(): Promise<string[] | "fallback"> {
  try {
    const dialog = await import("@tauri-apps/plugin-dialog")
    const selected = await dialog.open({
      multiple: true,
      directory: false,
      title: "选择文件",
    })
    if (Array.isArray(selected)) return selected.filter((item): item is string => typeof item === "string" && !!item)
    if (typeof selected === "string" && selected) return [selected]
    return []
  } catch {
    return "fallback"
  }
}

export async function pickAttachmentFolder(): Promise<string | null | "fallback"> {
  try {
    const dialog = await import("@tauri-apps/plugin-dialog")
    const selected = await dialog.open({
      directory: true,
      multiple: false,
      title: "选择文件夹",
    })
    if (typeof selected === "string" && selected) return selected
    return null
  } catch {
    return "fallback"
  }
}

const JSON_FILTER = [{ name: "JSON", extensions: ["json"] }]

function ensureJsonPath(path: string) {
  return path.toLowerCase().endsWith(".json") ? path : `${path}.json`
}

async function invokeUserFile<T>(cmd: "user_file_read" | "user_file_write", args: Record<string, unknown>) {
  const { invoke } = await import("@tauri-apps/api/core")
  return (await invoke(cmd, args)) as T
}

function downloadTextFile(filename: string, contents: string) {
  const blob = new Blob([contents], { type: "application/json;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function pickBrowserTextFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = "application/json,.json"
    input.addEventListener("change", () => {
      const file = input.files?.[0]
      if (!file) {
        resolve(null)
        return
      }
      void file.text().then(resolve, () => resolve(null))
    })
    input.addEventListener("cancel", () => resolve(null))
    input.click()
  })
}

export async function saveTextFile(defaultName: string, contents: string): Promise<boolean> {
  let picked: string | null = null
  try {
    const dialog = await import("@tauri-apps/plugin-dialog")
    const selected = await dialog.save({
      defaultPath: defaultName,
      filters: JSON_FILTER,
      title: "导出模型配置",
    })
    if (typeof selected !== "string" || !selected) return false
    picked = ensureJsonPath(selected)
    await invokeUserFile("user_file_write", { path: picked, content: contents })
    return true
  } catch (error) {
    if (picked) throw error instanceof Error ? error : new Error("导出失败")
    downloadTextFile(defaultName, contents)
    return true
  }
}

export async function openTextFile(): Promise<string | null> {
  let picked: string | null = null
  try {
    const dialog = await import("@tauri-apps/plugin-dialog")
    const selected = await dialog.open({
      multiple: false,
      directory: false,
      filters: JSON_FILTER,
      title: "导入模型配置",
    })
    const path = Array.isArray(selected) ? selected[0] : selected
    if (typeof path !== "string" || !path) return null
    picked = path
    return await invokeUserFile<string>("user_file_read", { path })
  } catch (error) {
    if (picked) throw error instanceof Error ? error : new Error("导入失败")
    return pickBrowserTextFile()
  }
}
