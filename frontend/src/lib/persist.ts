import { STORAGE_KEYS } from "./config"
import type { Project } from "./types"

export const LOCAL_PROJECT_ID = "prj_local"
export const LOCAL_PROJECT_NAME = "本机"

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}

export function basename(path: string) {
  const trimmed = path.replace(/[\\/]+$/, "")
  const parts = trimmed.split(/[\\/]/)
  return parts[parts.length - 1] || trimmed
}

export function samePath(left: string, right: string) {
  const normalize = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "")
  return normalize(left) === normalize(right)
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
  localStorage.setItem(STORAGE_KEYS.projects, JSON.stringify(projects))
}

export function loadLastProject() {
  return localStorage.getItem(STORAGE_KEYS.lastProject)
}

export function saveLastProject(id: string) {
  localStorage.setItem(STORAGE_KEYS.lastProject, id)
}

export function clearLastProject() {
  localStorage.removeItem(STORAGE_KEYS.lastProject)
}

export function createProject(path: string): Project {
  return {
    id: uid("prj"),
    path,
    name: basename(path),
    expanded: true,
  }
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
