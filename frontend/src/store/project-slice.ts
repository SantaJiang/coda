import { applySessionSnapshot, captureSessionSnapshot, readSessionSnapshot } from "./session-snapshot"
import { produce } from "solid-js/store"
import { isUnreachableError } from "../lib/api"
import { isLocalDraft, mergeSessionLists } from "../lib/draft-session"
import {
  createProject,
  clearProjectSessions,
  directoryExists,
  filterProjectSessions,
  isLocalProject,
  loadProjectSessions,
  restoreCandidates,
  saveProjectSessions,
  missingDirectoryMessage,
  MISSING_DIRECTORY_HINT,
  parseMissingDirectory,
  pickDirectory,
  pickSelectedProjectId,
  saveLastProject,
  samePath,
  basename,
} from "../lib/persist"
import type { BackendProject, Project, Session } from "../lib/types"
import type { ProjectApi } from "./contracts"
import { persistDraftSessions, rekeyDraftSessions, removeDraftSessions, startDraftSession } from "./draft-session-state"
import { sessionLifetime, purgeSession } from "./gc"
import { markProjectMissing, reportError, selectedProjectOf, selectedSessionOf, type StoreHandle } from "./handle"
import { directoryFor, projectForSession } from "./lookup"

export type ProjectSlice = ProjectApi & {
  refreshProjectSessions: (project: Project) => Promise<void>
  hydrateProjectPath: (project: Project) => Promise<void>
  resyncSession: (session: Session) => Promise<void>
  restoreProjects: (list: BackendProject[]) => Promise<void>
}

const newDraftPatch = { selectedSessionId: null, draft: true, draftPlanMode: false }

export function createProjectSlice(handle: StoreHandle): ProjectSlice {
  const { state, setState, client } = handle
  const detailGen = new Map<string, number>()
  const sessionListGen = new Map<string, number>()
  const projectCurrent = (project: Project) =>
    state.projects.some((item) => item.id === project.id && samePath(item.path, project.path))

  const selectedProject = () => selectedProjectOf(state)
  const selectedSession = () => selectedSessionOf(state)

  const setProjectMissingMessage = (path?: string) => {
    if (path) markProjectMissing(handle, path)
    setState("error", MISSING_DIRECTORY_HINT)
  }

  function rememberSessions(project: Project, sessions: Session[]) {
    if (isLocalProject(project)) return
    saveProjectSessions(project.id, sessions)
  }

  function cachedSessions(project: Project): Session[] {
    return filterProjectSessions(loadProjectSessions(project.id), project.path).map((session) => ({
      ...session,
      directory: project.path,
    }))
  }

  async function refreshProjectSessions(project: Project) {
    if (project.missing) {
      const cached = cachedSessions(project)
      if (cached.length) setState("sessionsByProject", project.path, cached)
      return
    }
    const gen = (sessionListGen.get(project.path) ?? 0) + 1
    sessionListGen.set(project.path, gen)
    const known = new Set((state.sessionsByProject[project.path] ?? []).map((session) => session.id))
    try {
      const sessions = await client.listSessions(
        project.path,
        isLocalProject(project) ? undefined : { scope: "project" },
      )
      if (sessionListGen.get(project.path) !== gen || !projectCurrent(project)) return
      const localAfter = state.sessionsByProject[project.path] ?? []
      const localById = new Map(localAfter.map((session) => [session.id, session]))
      const removedDuring = new Set([...known].filter((id) => !localById.has(id)))
      const roots = filterProjectSessions(sessions ?? [], project.path)
        .filter(
          (session) =>
            !session.parentID &&
            !session.time.archived &&
            !removedDuring.has(session.id) &&
            !state.removedSessions[session.id],
        )
        .map((session) => ({ ...session, directory: project.path }))
      const merged = roots.map((remote) => {
        const local = localById.get(remote.id)
        if (!local) return remote
        const localUpdated = local.time?.updated ?? 0
        const remoteUpdated = remote.time?.updated ?? 0
        if (!known.has(remote.id) || localUpdated > remoteUpdated)
          return { ...remote, ...local, directory: project.path }
        return remote
      })
      const rootIds = new Set(roots.map((session) => session.id))
      const arrived = localAfter.filter((session) => !known.has(session.id) && !rootIds.has(session.id))
      const next = [...arrived, ...merged]
      setState("sessionsByProject", project.path, next)
      rememberSessions(project, next)
    } catch (error) {
      if (sessionListGen.get(project.path) !== gen || !projectCurrent(project)) return
      if (isUnreachableError(error)) return
      const message = error instanceof Error ? error.message : "加载会话失败"
      const missing = missingDirectoryMessage(message)
      if (missing) {
        setProjectMissingMessage(parseMissingDirectory(message) ?? project.path)
        const cached = cachedSessions(project)
        if (cached.length) setState("sessionsByProject", project.path, cached)
      } else setState("error", message)
    }
  }

  async function hydrateProjectPath(project: Project) {
    if (isLocalProject(project)) {
      await refreshProjectSessions(project)
      return
    }
    const exists = await directoryExists(project.path)
    if (!projectCurrent(project)) return
    if (exists === false) {
      markProjectMissing(handle, project.path)
      await refreshProjectSessions({ ...project, missing: true })
      if (state.selectedProjectId === project.id) setState("error", MISSING_DIRECTORY_HINT)
      return
    }
    await refreshProjectSessions(project)
  }

  async function loadSessionDetail(session: Session, opts: { merge?: boolean } = {}) {
    if (state.removedSessions[session.id]) return
    const gen = (detailGen.get(session.id) ?? 0) + 1
    detailGen.set(session.id, gen)
    const directory = directoryFor(state, session)
    const before = captureSessionSnapshot(state, session.id)
    const current = () =>
      detailGen.get(session.id) === gen &&
      !state.removedSessions[session.id] &&
      (state.sessionEpoch[session.id] ?? 0) === before.epoch
    try {
      const snapshot = await readSessionSnapshot(client, directory, session.id)
      if (!current()) return
      const todoListUnchanged = state.todos[session.id] === before.todoListBefore
      setState(
        produce((draft) =>
          applySessionSnapshot(draft, session.id, before, snapshot, {
            mode: "detail",
            ...opts,
            session,
            todoListUnchanged,
          }),
        ),
      )
    } catch (error) {
      if (current()) reportError(handle, error, "加载会话失败", directory)
    }
  }

  return {
    projects: () => state.projects,
    sessionsFor: (path) =>
      mergeSessionLists(state.draftSessionsByProject[path] ?? [], state.sessionsByProject[path] ?? []),
    selectedProject,
    selectedSession,
    selectedSessionId: () => state.selectedSessionId,
    connection: () => state.connection,
    error: () => state.error ?? state.backendError,
    vcsBranch: () => state.vcsBranch,
    refreshProjectSessions,
    hydrateProjectPath,
    resyncSession: (session) => {
      if (isLocalDraft(session)) return Promise.resolve()
      return loadSessionDetail(session, { merge: true })
    },
    restoreProjects: async (list) => {
      const groups = restoreCandidates(state.projects, list)
      if (!groups.length) return
      const next: Project[] = []
      for (const dirs of groups) {
        let path = dirs[0]
        for (const dir of dirs) {
          if ((await directoryExists(dir)) !== false) {
            path = dir
            break
          }
        }
        next.push(createProject(path))
      }
      const projects = [...state.projects, ...next]
      setState("projects", projects)
      if (!state.selectedProjectId) {
        const fallback = pickSelectedProjectId(projects, null)
        if (fallback) {
          setState("selectedProjectId", fallback)
          saveLastProject(fallback)
        }
      }
      await Promise.all(next.map((project) => hydrateProjectPath(project)))
    },
    addProject: async () => {
      const path = await pickDirectory()
      if (!path) return
      const existing = state.projects.find((project) => samePath(project.path, path))
      if (existing) {
        const restored = { ...existing, expanded: true, missing: false }
        setState(
          "projects",
          state.projects.map((project) => (project.id === existing.id ? restored : project)),
        )
        setState("selectedProjectId", existing.id)
        setState("error", null)
        saveLastProject(existing.id)
        await refreshProjectSessions(restored)
        return
      }
      const project = createProject(path)
      const projects = [...state.projects, project]
      setState("projects", projects)
      setState({ selectedProjectId: project.id, ...newDraftPatch, error: null })
      saveLastProject(project.id)
      await refreshProjectSessions(project)
    },
    relocateProject: async (id) => {
      const current = state.projects.find((project) => project.id === id)
      if (!current || isLocalProject(current)) return null
      sessionListGen.set(current.path, (sessionListGen.get(current.path) ?? 0) + 1)
      const path = await pickDirectory()
      if (!path) return null
      const duplicate = state.projects.find((project) => project.id !== id && samePath(project.path, path))
      if (duplicate) {
        const previousPath = current.path
        const restored = { ...duplicate, missing: false, expanded: true }
        const projects = state.projects
          .filter((project) => project.id !== id)
          .map((project) => (project.id === duplicate.id ? restored : project))
        setState("projects", projects)
        const selectedDraftId = state.selectedSessionId
        setState(
          produce((draft) => {
            delete draft.sessionsByProject[previousPath]
            rekeyDraftSessions(draft, previousPath, restored.path)
          }),
        )
        persistDraftSessions(handle, true)
        const keptDraft =
          selectedDraftId &&
          (state.draftSessionsByProject[restored.path] ?? []).some((item) => item.id === selectedDraftId)
        setState({
          selectedProjectId: duplicate.id,
          ...(keptDraft ? { selectedSessionId: selectedDraftId, draft: true, draftPlanMode: false } : newDraftPatch),
          error: null,
        })
        saveLastProject(duplicate.id)
        clearProjectSessions(id)
        await refreshProjectSessions(restored)
        return restored
      }
      const previousPath = current.path
      const previousSessions = state.sessionsByProject[previousPath] ?? []
      const next: Project = {
        ...current,
        path,
        name: basename(path),
        missing: false,
        expanded: true,
      }
      setState(
        "projects",
        state.projects.map((project) => (project.id === id ? next : project)),
      )
      setState("selectedProjectId", id)
      setState("error", null)
      saveLastProject(id)
      if (!samePath(previousPath, path)) {
        setState(
          produce((draft) => {
            draft.sessionsByProject[path] = previousSessions.map((session) => ({ ...session, directory: path }))
            delete draft.sessionsByProject[previousPath]
            rekeyDraftSessions(draft, previousPath, path)
          }),
        )
        persistDraftSessions(handle, true)
      }
      await refreshProjectSessions(next)
      return next
    },
    toggleProject: (id) => {
      setState(
        "projects",
        (project) => project.id === id,
        "expanded",
        (expanded) => !expanded,
      )
    },
    selectProject: (id) => {
      const project = state.projects.find((item) => item.id === id)
      const changed = state.selectedProjectId !== id
      setState("selectedProjectId", id)
      saveLastProject(id)
      const sessions = project
        ? [...(state.sessionsByProject[project.path] ?? []), ...(state.draftSessionsByProject[project.path] ?? [])]
        : []
      if (state.selectedSessionId && !sessions.some((session) => session.id === state.selectedSessionId)) {
        setState(newDraftPatch)
      } else if (changed && !state.selectedSessionId) {
        setState("draftPlanMode", false)
      }
      if (project?.missing) setState("error", MISSING_DIRECTORY_HINT)
      else if (state.error === MISSING_DIRECTORY_HINT) setState("error", null)
    },
    removeProject: (id) => {
      const removed = state.projects.find((project) => project.id === id)
      if (!removed || isLocalProject(removed)) return
      sessionListGen.set(removed.path, (sessionListGen.get(removed.path) ?? 0) + 1)
      const projects = state.projects.filter((project) => project.id !== id)
      setState("projects", projects)
      setState(
        produce((draft) => {
          for (const session of draft.sessionsByProject[removed.path] ?? []) purgeSession(draft, session.id, false)
          for (const session of draft.draftSessionsByProject[removed.path] ?? []) purgeSession(draft, session.id, false)
          delete draft.sessionsByProject[removed.path]
          delete draft.draftSessionsByProject[removed.path]
        }),
      )
      clearProjectSessions(id)
      persistDraftSessions(handle, true)
      if (state.selectedProjectId === id) {
        const fallback = pickSelectedProjectId(projects, null)
        setState({
          selectedProjectId: fallback,
          ...newDraftPatch,
          error: null,
        })
        if (fallback) saveLastProject(fallback)
      }
    },
    closeProject: () => {
      const local = state.projects.find(isLocalProject)
      setState({
        selectedProjectId: local?.id ?? null,
        ...newDraftPatch,
        error: null,
      })
      if (local) saveLastProject(local.id)
    },
    renameSession: async (session, title) => {
      if (isLocalDraft(session)) return
      const trimmed = title.trim()
      if (!trimmed || trimmed === session.title) return
      const current = sessionLifetime(state, session.id)
      try {
        const directory = directoryFor(state, session)
        const updated = await client.updateSessionTitle(directory, session.id, trimmed)
        if (!current()) return
        setState("sessionsByProject", directory, (list = []) =>
          list.map((item) => (item.id === session.id ? { ...updated, directory } : item)),
        )
      } catch (error) {
        if (current()) reportError(handle, error, "重命名失败")
      }
    },
    deleteSession: async (session) => {
      const directory = directoryFor(state, session)
      if (isLocalDraft(session)) {
        removeDraftSessions(handle, [session.id])
        if (state.selectedSessionId === session.id) {
          setState({
            ...newDraftPatch,
            error: null,
          })
        }
        persistDraftSessions(handle, true)
        return
      }
      try {
        await client.deleteSession(directory, session.id)
        setState(
          produce((draft) => {
            const list = draft.sessionsByProject[directory] ?? []
            draft.sessionsByProject[directory] = list.filter((item) => item.id !== session.id)
            purgeSession(draft, session.id)
            if (draft.selectedSessionId === session.id) {
              draft.selectedSessionId = null
              draft.draft = true
              draft.draftPlanMode = false
            }
          }),
        )
      } catch (error) {
        reportError(handle, error, "删除会话失败")
      }
    },
    startDraft: () => {
      const project = selectedProject()
      if (!project) return
      if (project.missing) {
        setState("error", MISSING_DIRECTORY_HINT)
        return
      }
      startDraftSession(handle, project)
    },
    selectSession: async (session) => {
      const project = projectForSession(state, session)
      if (project?.missing) {
        setState("error", MISSING_DIRECTORY_HINT)
        return
      }
      const local = isLocalDraft(session)
      setState({
        selectedSessionId: session.id,
        selectedProjectId: project?.id ?? state.selectedProjectId,
        draft: local,
        draftPlanMode: false,
        error: null,
      })
      setState("attention", session.id, false)
      if (project) saveLastProject(project.id)
      if (local) return
      await loadSessionDetail(session)
    },
  }
}
