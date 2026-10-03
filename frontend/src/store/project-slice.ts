import { produce } from "solid-js/store"
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
import { mergeMessages, mergeParts, resolveRacingSessionStatus, resolveSessionStatus } from "../lib/session-sync"
import { deriveStatusFromMessages, hasFailingAssistant } from "../lib/session-status"
import type { BackendProject, Message, Part, Project, Session } from "../lib/types"
import type { ProjectApi } from "./contracts"
import {
  persistDraftSessions,
  rekeyDraftSessions,
  removeDraftSessions,
  startDraftSession,
} from "./draft-session-state"
import { purgeSession } from "./gc"
import {
  inferPlanMode,
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
  resyncSession: (session: Session) => Promise<void>
  restoreProjects: (list: BackendProject[]) => Promise<void>
}

const newDraftPatch = { selectedSessionId: null, draft: true, draftPlanMode: false }
let detailGen = 0
const sessionListGen = new Map<string, number>()

type Listed<T> = { ok: true; value: T } | { ok: false }

function listed<T>(promise: Promise<T>): Promise<Listed<T>> {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    () => ({ ok: false as const }),
  )
}

function statusKey(status: ReturnType<typeof deriveStatusFromMessages> | undefined) {
  if (!status) return ""
  return `${status.type}:${status.type === "retry" ? `${status.attempt ?? ""}:${status.next ?? ""}` : ""}`
}

function hashValue(value: unknown) {
  if (value === undefined) return "0"
  let raw: string
  try {
    raw = JSON.stringify(value) ?? ""
  } catch {
    return "-1"
  }
  let hash = 5381
  for (let index = 0; index < raw.length; index += 1) {
    hash = ((hash << 5) + hash + raw.charCodeAt(index)) | 0
  }
  return `${raw.length}:${hash}`
}

function partKey(part: Part) {
  if (part.type === "text") return `${part.id}:text:${hashValue(part.text)}`
  if (part.type === "reasoning") {
    return `${part.id}:reasoning:${hashValue(part.text)}:${part.time?.start ?? ""}:${part.time?.end ?? ""}`
  }
  if (part.type === "tool") {
    const state = part.state
    const title = "title" in state ? state.title ?? "" : ""
    const metadata = "metadata" in state ? state.metadata : undefined
    const output = state.status === "completed" ? hashValue(state.output) : "0"
    const error = state.status === "error" ? hashValue(state.error) : "0"
    const time = "time" in state ? state.time : undefined
    const end = time && "end" in time ? time.end ?? "" : ""
    return `${part.id}:tool:${state.status}:${hashValue(title)}:${hashValue(state.input)}:${hashValue(metadata)}:${output}:${error}:${end}`
  }
  return `${part.id}:${part.type}`
}

function sessionSnapshotKey(status: ReturnType<typeof deriveStatusFromMessages> | undefined, messages: Message[], parts: Record<string, Part[]>) {
  const content = messages.map((message) => {
    const completed = message.role === "assistant" ? message.time.completed ?? "" : ""
    const info = `${message.id}:${message.role}:${completed}:${Boolean(message.role === "assistant" && message.error)}`
    return `${info}[${(parts[message.id] ?? []).map(partKey).join(",")}]`
  })
  return `${statusKey(status)}|${content.join("|")}`
}

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
      if (sessionListGen.get(project.path) !== gen) return
      const localAfter = state.sessionsByProject[project.path] ?? []
      const localById = new Map(localAfter.map((session) => [session.id, session]))
      const removedDuring = new Set([...known].filter((id) => !localById.has(id)))
      const roots = filterProjectSessions(sessions ?? [], project.path)
        .filter((session) => !session.parentID && !session.time.archived && !removedDuring.has(session.id))
        .map((session) => ({ ...session, directory: project.path }))
      const merged = roots.map((remote) => {
        const local = localById.get(remote.id)
        if (!local) return remote
        const localUpdated = local.time?.updated ?? 0
        const remoteUpdated = remote.time?.updated ?? 0
        if (!known.has(remote.id) || localUpdated > remoteUpdated) return { ...remote, ...local, directory: project.path }
        return remote
      })
      const rootIds = new Set(roots.map((session) => session.id))
      const arrived = localAfter.filter((session) => !known.has(session.id) && !rootIds.has(session.id))
      const next = [...arrived, ...merged]
      setState("sessionsByProject", project.path, next)
      rememberSessions(project, next)
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

  async function loadSessionDetail(session: Session, opts: { merge?: boolean } = {}) {
    const gen = ++detailGen
    const directory = directoryFor(state, session)
    const beforeMessages = state.messages[session.id] ?? []
    const beforeMessageIds = new Set(beforeMessages.map((item) => item.id))
    const beforePartIds = new Map<string, Set<string>>()
    for (const messageID of beforeMessageIds) {
      beforePartIds.set(messageID, new Set((state.parts[messageID] ?? []).map((part) => part.id)))
    }
    const beforePermissionIds = new Set(
      Object.entries(state.permissions)
        .filter(([, item]) => item?.sessionID === session.id)
        .map(([id]) => id),
    )
    const beforeQuestionIds = new Set(
      Object.entries(state.questions)
        .filter(([, item]) => item?.sessionID === session.id)
        .map(([id]) => id),
    )
    const snapshotBefore = sessionSnapshotKey(state.status[session.id], beforeMessages, state.parts)
    const [messages, todos, permissions, questions, statuses] = await Promise.all([
      client.listMessages(directory, session.id),
      listed(client.listTodos(directory, session.id)),
      listed(client.listPermissions(directory)),
      listed(client.listQuestions(directory)),
      listed(client.listSessionStatuses(directory)),
    ])
    if (gen !== detailGen) return

    setState(
      produce((draft) => {
        const localMessages = draft.messages[session.id] ?? []
        const removedMessages = new Set(
          [...beforeMessageIds].filter((id) => !localMessages.some((item) => item.id === id)),
        )
        const infos = messages
          .map((item) => item.info)
          .filter((info) => !removedMessages.has(info.id))
        const stateUnchanged =
          sessionSnapshotKey(draft.status[session.id], localMessages, draft.parts) === snapshotBefore
        const shouldMerge = Boolean(opts.merge) || !stateUnchanged
        const nextMessages = shouldMerge ? mergeMessages(localMessages, infos) : infos
        draft.messages[session.id] = nextMessages
        for (const item of messages) {
          if (removedMessages.has(item.info.id)) {
            delete draft.parts[item.info.id]
            continue
          }
          const knownParts = beforePartIds.get(item.info.id)
          const currentParts = draft.parts[item.info.id] ?? []
          const incomingParts = (item.parts ?? []).filter((part) => {
            if (!knownParts?.has(part.id)) return true
            return currentParts.some((entry) => entry.id === part.id)
          })
          draft.parts[item.info.id] = shouldMerge
            ? mergeParts(currentParts, incomingParts)
            : incomingParts
        }
        if (todos.ok) draft.todos[session.id] = todos.value ?? []
        const fromMessages = deriveStatusFromMessages(nextMessages)
        const lastRole = nextMessages[nextMessages.length - 1]?.role
        const derived = stateUnchanged
          ? resolveSessionStatus(
              session.id,
              statuses.ok ? (statuses.value ?? null) : null,
              draft.status[session.id],
              fromMessages,
              Boolean(opts.merge),
              lastRole,
            )
          : resolveRacingSessionStatus(draft.status[session.id], fromMessages, lastRole)
        if (derived) draft.status[session.id] = derived
        const failing = hasFailingAssistant(nextMessages)
        draft.sessionErrors[session.id] = failing
        if (
          !failing &&
          nextMessages.some((item) => item.role === "assistant" && Boolean(item.time.completed) && !item.error)
        ) {
          delete draft.sessionErrorText[session.id]
        }
        if (draft.planModeBySession[session.id] === undefined) {
          draft.planModeBySession[session.id] = inferPlanMode(session, nextMessages)
        }
        if (permissions.ok) {
          const removed = new Set([...beforePermissionIds].filter((id) => !draft.permissions[id]))
          const incoming = (permissions.value ?? []).filter(
            (item) => item.sessionID === session.id && !removed.has(item.id),
          )
          const incomingIds = new Set(incoming.map((item) => item.id))
          for (const id of beforePermissionIds) {
            if (draft.permissions[id] && !incomingIds.has(id)) delete draft.permissions[id]
          }
          for (const item of incoming) draft.permissions[item.id] = item
        }
        if (questions.ok) {
          const removed = new Set([...beforeQuestionIds].filter((id) => !draft.questions[id]))
          const incoming = (questions.value ?? []).filter(
            (item) => item.sessionID === session.id && !removed.has(item.id),
          )
          const incomingIds = new Set(incoming.map((item) => item.id))
          for (const id of beforeQuestionIds) {
            if (draft.questions[id] && !incomingIds.has(id)) delete draft.questions[id]
          }
          for (const item of incoming) draft.questions[item.id] = item
        }
      }),
    )
  }

  return {
    projects: () => state.projects,
    sessionsFor: (path) =>
      mergeSessionLists(state.draftSessionsByProject[path] ?? [], state.sessionsByProject[path] ?? []),
    selectedProject,
    selectedSession,
    selectedSessionId: () => state.selectedSessionId,
    connection: () => state.connection,
    error: () => state.error,
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
          ...(keptDraft
            ? { selectedSessionId: selectedDraftId, draft: true, draftPlanMode: false }
            : newDraftPatch),
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
        ? [
            ...(state.sessionsByProject[project.path] ?? []),
            ...(state.draftSessionsByProject[project.path] ?? []),
          ]
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
      const projects = state.projects.filter((project) => project.id !== id)
      setState("projects", projects)
      setState(
        produce((draft) => {
          for (const session of draft.sessionsByProject[removed.path] ?? []) purgeSession(draft, session.id)
          for (const session of draft.draftSessionsByProject[removed.path] ?? []) purgeSession(draft, session.id)
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
