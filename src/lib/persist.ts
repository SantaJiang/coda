import { STORAGE_KEYS } from "./config"
import type { Project } from "./types"

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}

export function basename(path: string) {
  const trimmed = path.replace(/[\\/]+$/, "")
  const parts = trimmed.split(/[\\/]/)
  return parts[parts.length - 1] || trimmed
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
