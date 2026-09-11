import type { SetStoreFunction } from "solid-js/store"
import {
  isLocalProject,
  missingDirectoryMessage,
  MISSING_DIRECTORY_HINT,
  parseMissingDirectory,
  samePath,
} from "../lib/persist"
import { PLAN_AGENT } from "../lib/config"
import type { Message, Project, Session } from "../lib/types"
import type { AgentClient } from "./ports"
import type { AppState } from "./state"

export type StoreHandle = {
  state: AppState
  setState: SetStoreFunction<AppState>
  client: AgentClient
}

export function selectedProjectOf(state: AppState) {
  return state.projects.find((project) => project.id === state.selectedProjectId)
}

export function selectedSessionOf(state: AppState) {
  const project = selectedProjectOf(state)
  if (!project || !state.selectedSessionId) return undefined
  return (state.sessionsByProject[project.path] ?? []).find((session) => session.id === state.selectedSessionId)
}

export function activePlanMode(state: AppState): boolean {
  const id = state.selectedSessionId
  return id ? (state.planModeBySession[id] ?? false) : state.draftPlanMode
}

export function inferPlanMode(session?: { agent?: string }, messages: Message[] = []): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const agent = messages[index]?.agent
    if (agent) return agent === PLAN_AGENT
  }
  return session?.agent === PLAN_AGENT
}

export function markProjectMissing(handle: StoreHandle, path: string) {
  handle.setState(
    "projects",
    (project: Project) => !isLocalProject(project) && samePath(project.path, path),
    "missing",
    true,
  )
}

export function reportError(handle: StoreHandle, error: unknown, fallback: string, path?: string) {
  const message = error instanceof Error ? error.message : fallback
  const missing = missingDirectoryMessage(message)
  if (missing) {
    const missingPath = parseMissingDirectory(message) ?? path
    if (missingPath) markProjectMissing(handle, missingPath)
    handle.setState("error", MISSING_DIRECTORY_HINT)
    return
  }
  handle.setState("error", message)
}

export function projectOwningSession(state: AppState, sessionID: string): Project | undefined {
  return state.projects.find((entry) =>
    (state.sessionsByProject[entry.path] ?? []).some((session: Session) => session.id === sessionID),
  )
}
