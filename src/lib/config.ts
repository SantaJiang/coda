export const API_BASE = import.meta.env.VITE_OPENCODE_URL ?? "http://127.0.0.1:4096"

export const DEFAULT_MODEL = {
  providerID: "deepseek",
  modelID: "deepseek-v4-flash",
} as const

export const DEFAULT_AGENT = "build"

export const STORAGE_KEYS = {
  projects: "coda.projects",
  lastProject: "coda.lastProject",
} as const
