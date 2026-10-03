import { produce } from "solid-js/store"
import { draftKey } from "../lib/draft"
import {
  createLocalDraftSession,
  draftSidebarTitle,
  extraEmptyDraftIds,
  findEmptyDraft,
  isEmptyDraft,
  isEmptyDraftContent,
} from "../lib/draft-session"
import { saveDraftSessions, samePath } from "../lib/persist"
import type { Project, Session } from "../lib/types"
import { purgeSession } from "./gc"
import type { StoreHandle } from "./handle"
import { emptySessionDraft, type AppState } from "./state"

let persistTimer: ReturnType<typeof setTimeout> | undefined
let persistHandle: StoreHandle | undefined

function writeDraftSessions(handle: StoreHandle) {
  const { state } = handle
  saveDraftSessions(state.draftSessionsByProject, state.drafts, state.planModeBySession)
}

export function persistDraftSessions(handle: StoreHandle, immediate = false) {
  persistHandle = handle
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = undefined
  }
  if (immediate) {
    writeDraftSessions(handle)
    return
  }
  persistTimer = setTimeout(() => {
    persistTimer = undefined
    writeDraftSessions(handle)
  }, 200)
}

export function flushPendingDraftPersist() {
  if (!persistHandle) return
  persistDraftSessions(persistHandle, true)
}

export function expandProject(handle: StoreHandle, projectId: string) {
  handle.setState(
    "projects",
    (project: Project) => project.id === projectId,
    "expanded",
    true,
  )
}

export function openDraftSession(handle: StoreHandle, project: Project, session: Session, now = Date.now()) {
  const { setState } = handle
  setState(
    produce((draft) => {
      const item = (draft.draftSessionsByProject[project.path] ?? []).find((entry) => entry.id === session.id)
      if (item) item.time.updated = now
    }),
  )
  expandProject(handle, project.id)
  setState({
    selectedSessionId: session.id,
    selectedProjectId: project.id,
    draft: true,
    error: null,
  })
}

export function addDraftSession(handle: StoreHandle, project: Project, session: Session, copyPhantomPlan = false) {
  const { state, setState } = handle
  const plan = copyPhantomPlan ? state.draftPlanMode : false
  setState(
    produce((draft) => {
      draft.draftSessionsByProject[project.path] = [session, ...(draft.draftSessionsByProject[project.path] ?? [])]
      if (plan) {
        draft.planModeBySession[session.id] = true
        draft.draftPlanMode = false
      }
    }),
  )
  expandProject(handle, project.id)
  setState({
    selectedSessionId: session.id,
    selectedProjectId: project.id,
    draft: true,
    error: null,
  })
}

export function reuseOrCreateEmptyDraft(handle: StoreHandle, project: Project, copyPhantomPlan = false): Session {
  const { state, setState } = handle
  const list = state.draftSessionsByProject[project.path] ?? []
  const empty = findEmptyDraft(list, state.drafts)
  if (empty) {
    if (copyPhantomPlan && state.draftPlanMode) {
      setState(
        produce((draft) => {
          draft.planModeBySession[empty.id] = true
          draft.draftPlanMode = false
        }),
      )
    }
    openDraftSession(handle, project, empty)
    return empty
  }
  const session = createLocalDraftSession(project.path)
  addDraftSession(handle, project, session, copyPhantomPlan)
  return session
}

export function removeDraftSessions(handle: StoreHandle, ids: string[]) {
  if (!ids.length) return
  const { setState } = handle
  setState(
    produce((draft) => {
      for (const id of ids) purgeSession(draft, id)
    }),
  )
}

export function syncDraftSessionMeta(handle: StoreHandle, path: string, sessionId: string, composer: string) {
  const { setState } = handle
  const now = Date.now()
  const title = draftSidebarTitle(composer)
  setState(
    produce((draft) => {
      const list = draft.draftSessionsByProject[path] ?? []
      const item = list.find((entry) => entry.id === sessionId)
      if (item) {
        item.title = title
        item.time.updated = now
      }
      if (!isEmptyDraft(draft.drafts[`session:${sessionId}`])) return
      for (const extraId of extraEmptyDraftIds(list, draft.drafts, sessionId)) purgeSession(draft, extraId)
    }),
  )
}

export function movePhantomComposerToDraft(handle: StoreHandle, project: Project, session: Session) {
  const { state, setState } = handle
  const phantomKey = draftKey(null, project.id)
  const phantom = state.drafts[phantomKey]
  if (!phantom || isEmptyDraftContent(phantom.composer, phantom.attachments)) return
  setState("drafts", `session:${session.id}`, {
    composer: phantom.composer,
    attachments: phantom.attachments,
  })
  setState("drafts", phantomKey, emptySessionDraft())
  syncDraftSessionMeta(handle, project.path, session.id, phantom.composer)
}

export function startDraftSession(handle: StoreHandle, project: Project) {
  const { state } = handle
  const phantom = !state.selectedSessionId
  if (phantom) {
    const bundle = state.drafts[draftKey(null, project.id)]
    if (!isEmptyDraftContent(bundle?.composer, bundle?.attachments)) {
      const filled = reuseOrCreateEmptyDraft(handle, project, true)
      movePhantomComposerToDraft(handle, project, filled)
      persistDraftSessions(handle)
    }
  }
  reuseOrCreateEmptyDraft(handle, project, phantom && !state.selectedSessionId)
}

export function adoptDraftIntoBackendSession(handle: StoreHandle, draftId: string | null | undefined) {
  if (!draftId) return
  removeDraftSessions(handle, [draftId])
}

export function rekeyDraftSessions(draft: AppState, fromPath: string, toPath: string) {
  if (!fromPath || samePath(fromPath, toPath)) return
  const moving = draft.draftSessionsByProject[fromPath]
  if (!moving?.length) {
    delete draft.draftSessionsByProject[fromPath]
    return
  }
  const relocated = moving.map((session) => ({ ...session, directory: toPath }))
  const existing = draft.draftSessionsByProject[toPath] ?? []
  const merged = [...relocated, ...existing]
  draft.draftSessionsByProject[toPath] = merged
  delete draft.draftSessionsByProject[fromPath]
  const empty = findEmptyDraft(merged, draft.drafts)
  if (!empty) return
  const selectedId = draft.selectedSessionId
  const keepId =
    selectedId &&
    merged.some((session) => session.id === selectedId) &&
    isEmptyDraft(draft.drafts[`session:${selectedId}`])
      ? selectedId
      : empty.id
  for (const extraId of extraEmptyDraftIds(merged, draft.drafts, keepId)) purgeSession(draft, extraId)
}
