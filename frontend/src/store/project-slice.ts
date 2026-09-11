import { produce } from "solid-js/store"
import {
  createProject,
  clearProjectSessions,
  directoryExists,
  isLocalProject,
  loadProjectSessions,
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
import { deriveStatusFromMessages } from "../lib/session-status"
import type { PermissionRequest, Project, QuestionRequest, Session, Todo } from "../lib/types"
import type { ProjectApi } from "./contracts"
import { purgeSession, syncSessionRequests } from "./gc"
import {
  markProjectMissing,
  reportError,
  selectedProjectOf,
  selectedSessionOf,
  type StoreHandle,
} from "./handle"
import { directoryFor, projectForSession } from "./lookup"

export type ProjectSlice = ProjectApi & {
  refreshProjectSessions: (project: Project) => Promise<void>
  hydrateProjectPath: (project: Project) => Promise<void>
}

const newDraftPatch = { selectedSessionId: null, draft: true, planMode: false }

export function createProjectSlice(handle: StoreHandle): ProjectSlice {
  const { state, setState, client } = handle

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
    return loadProjectSessions(project.id).map((session) => ({ ...session, directory: project.path }))
  }

  async function refreshProjectSessions(project: Project) {
    if (project.missing) {
      const cached = cachedSessions(project)
      if (cached.length) setState("sessionsByProject", project.path, cached)
      return
    }
    try {
      const sessions = await client.listSessions(
        project.path,
        isLocalProject(project) ? undefined : { scope: "project" },
      )
      const roots = (sessions ?? [])
        .filter((session) => !session.parentID && !session.time.archived)
        .map((session) => ({ ...session, directory: project.path }))
      setState("sessionsByProject", project.path, roots)
      rememberSessions(project, roots)
    } catch (error) {
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
    if (exists === false) {
      markProjectMissing(handle, project.path)
      await refreshProjectSessions({ ...project, missing: true })
      if (state.selectedProjectId === project.id) setState("error", MISSING_DIRECTORY_HINT)
      return
    }
    await refreshProjectSessions(project)
  }

  async function loadSessionDetail(session: Session) {
    const directory = directoryFor(state, session)
    const [messages, todos, permissions, questions] = await Promise.all([
      client.listMessages(directory, session.id),
      client.listTodos(directory, session.id).catch(() => [] as Todo[]),
      client.listPermissions(directory).catch(() => [] as PermissionRequest[]),
      client.listQuestions(directory).catch(() => [] as QuestionRequest[]),
    ])

    setState(
      produce((draft) => {
        const infos = messages.map((item) => item.info)
        draft.messages[session.id] = infos
        for (const item of messages) {
          draft.parts[item.info.id] = item.parts ?? []
        }
        draft.todos[session.id] = todos ?? []
        const derived = deriveStatusFromMessages(infos)
        if (derived) draft.status[session.id] = derived
        syncSessionRequests(draft, session.id, permissions ?? [], questions ?? [])
      }),
    )
  }

  return {
    projects: () => state.projects,
    sessionsFor: (path) => state.sessionsByProject[path] ?? [],
    selectedProject,
    selectedSession,
    selectedSessionId: () => state.selectedSessionId,
    connection: () => state.connection,
    error: () => state.error,
    vcsBranch: () => state.vcsBranch,
    refreshProjectSessions,
    hydrateProjectPath,
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
        setState(
          produce((draft) => {
            delete draft.sessionsByProject[previousPath]
          }),
        )
        setState({
          selectedProjectId: duplicate.id,
          ...newDraftPatch,
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
          }),
        )
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
      setState("selectedProjectId", id)
      saveLastProject(id)
      const sessions = project ? (state.sessionsByProject[project.path] ?? []) : []
      if (state.selectedSessionId && !sessions.some((session) => session.id === state.selectedSessionId)) {
        setState(newDraftPatch)
      }
      if (project?.missing) setState("error", MISSING_DIRECTORY_HINT)
      else if (state.error === MISSING_DIRECTORY_HINT) setState("error", null)
    },
    removeProject: (id) => {
      const removed = state.projects.find((project) => project.id === id)
      if (!removed || isLocalProject(removed)) return
      const projects = state.projects.filter((project) => project.id !== id)
      setState("projects", projects)
      setState(
        produce((draft) => {
          for (const session of draft.sessionsByProject[removed.path] ?? []) purgeSession(draft, session.id)
          delete draft.sessionsByProject[removed.path]
        }),
      )
      clearProjectSessions(id)
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
      const trimmed = title.trim()
      if (!trimmed || trimmed === session.title) return
      try {
        const directory = directoryFor(state, session)
        const updated = await client.updateSessionTitle(directory, session.id, trimmed)
        setState("sessionsByProject", directory, (list = []) =>
          list.map((item) => (item.id === session.id ? { ...updated, directory } : item)),
        )
      } catch (error) {
        reportError(handle, error, "重命名失败")
      }
    },
    deleteSession: async (session) => {
      try {
        const directory = directoryFor(state, session)
        await client.deleteSession(directory, session.id)
        setState(
          produce((draft) => {
            const list = draft.sessionsByProject[directory] ?? []
            draft.sessionsByProject[directory] = list.filter((item) => item.id !== session.id)
            purgeSession(draft, session.id)
            if (draft.selectedSessionId === session.id) {
              draft.selectedSessionId = null
              draft.draft = true
              draft.planMode = false
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
      setState({
        ...newDraftPatch,
        error: null,
      })
    },
    selectSession: async (session) => {
      const project = projectForSession(state, session)
      if (project?.missing) {
        setState("error", MISSING_DIRECTORY_HINT)
        return
      }
      setState({
        selectedSessionId: session.id,
        selectedProjectId: project?.id ?? state.selectedProjectId,
        draft: false,
        error: null,
      })
      setState("attention", session.id, false)
      setState("sessionErrors", session.id, false)
      if (project) saveLastProject(project.id)
      await loadSessionDetail(session)
    },
  }
}
