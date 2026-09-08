export const API_BASE = import.meta.env.VITE_CODA_URL ?? "http://127.0.0.1:4096"

export const DEFAULT_AGENT = "build"
export const PLAN_AGENT = "plan"

export const STORAGE_KEYS = {
  projects: "coda.projects",
  lastProject: "coda.lastProject",
  projectSessions: "coda.projectSessions",
  permissionMode: "coda.permissionMode",
  sendShortcut: "coda.sendShortcut",
} as const
