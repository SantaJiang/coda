import { samePath } from "../lib/path"
import type { Project, Session } from "../lib/types"
import type { AppState } from "./state"

export function projectForSession(state: AppState, session: Session) {
  return state.projects.find(
    (project) =>
      samePath(project.path, session.directory) ||
      (state.sessionsByProject[project.path] ?? []).some((item) => item.id === session.id) ||
      (state.draftSessionsByProject[project.path] ?? []).some((item) => item.id === session.id),
  )
}

export function directoryFor(state: AppState, session: Session, project?: Project) {
  return project?.path ?? projectForSession(state, session)?.path ?? session.directory
}

export function sendingKey(sessionID: string | null | undefined, projectId: string | null | undefined) {
  return sessionID ?? `__draft:${projectId ?? "_"}__`
}

export function projectByPath(state: AppState, directory: string) {
  return state.projects.find((item) => item.path === directory || samePath(item.path, directory))
}
