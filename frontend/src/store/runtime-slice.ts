import { produce } from "solid-js/store"
import { draftKey } from "../lib/draft"
import { isEmptyDraftContent, isLocalDraft } from "../lib/draft-session"
import { PLAN_AGENT, DEFAULT_AGENT } from "../lib/config"
import {
  attachmentFromBrowserFile,
  attachmentFromPath,
  type ComposerAttachment,
} from "../lib/attachments"
import { rulesetForProject } from "../lib/permissions"
import {
  isLocalProject,
  MISSING_DIRECTORY_HINT,
  pickAttachmentFolder,
  pickBrowserFiles,
  pickFiles,
} from "../lib/persist"
import { cutAtRevert, revertDraftFromParts } from "../lib/revert"
import { isSessionBusy, sessionDotKind } from "../lib/session-status"
import { uid } from "../lib/uid"
import { upsertById } from "../lib/upsert"
import type { Project } from "../lib/types"
import type { RuntimeApi } from "./contracts"
import {
  persistDraftSessions,
  reuseOrCreateEmptyDraft,
  adoptDraftIntoBackendSession,
  syncDraftSessionMeta,
} from "./draft-session-state"
import {
  activePlanMode,
  projectOwningSession,
  reportError,
  selectedProjectOf,
  selectedSessionOf,
  type StoreHandle,
} from "./handle"
import { directoryFor, projectByPath, sendingKey } from "./lookup"
import { selectedModelOf } from "./model-slice"
import { applySessionPermission } from "./permission-sync"
import { shouldFlushQueue, takeDeferredSend, withSessionLock } from "./queue"
import { emptySessionDraft, type QueuedMessage, type SessionDraft } from "./state"

export type QueueRefs = {
  skipQueueFlush: Record<string, boolean>
  sendAfterIdle: Record<string, QueuedMessage | undefined>
  flushing: Record<string, boolean>
}

export type RuntimeSlice = RuntimeApi & {
  flushQueue: (sessionID: string) => Promise<void>
}

export function createRuntimeSlice(handle: StoreHandle, refs: QueueRefs): RuntimeSlice {
  const { state, setState, client } = handle
  const replying = new Set<string>()

  const selectedProject = () => selectedProjectOf(state)
  const selectedSession = () => selectedSessionOf(state)
  const activeDraftKey = () => draftKey(state.selectedSessionId, state.selectedProjectId)
  const currentDraft = () => state.drafts[activeDraftKey()] ?? emptySessionDraft()
  const composer = () => currentDraft().composer
  const attachments = () => currentDraft().attachments
  const currentAgent = () => (activePlanMode(state) ? PLAN_AGENT : DEFAULT_AGENT)

  const writeDraft = (patch: Partial<SessionDraft>) => {
    const project = selectedProject()
    const prev = currentDraft()
    const next = {
      composer: patch.composer ?? prev.composer,
      attachments: patch.attachments ?? prev.attachments,
    }
    const hasContent = !isEmptyDraftContent(next.composer, next.attachments)

    if (project && !project.missing && !state.selectedSessionId && hasContent) {
      const session = reuseOrCreateEmptyDraft(handle, project, true)
      const phantomKey = draftKey(null, project.id)
      setState("drafts", `session:${session.id}`, next)
      if (phantomKey !== `session:${session.id}`) setState("drafts", phantomKey, emptySessionDraft())
      syncDraftSessionMeta(handle, project.path, session.id, next.composer)
      persistDraftSessions(handle)
      return
    }

    const key = draftKey(state.selectedSessionId, state.selectedProjectId)
    setState("drafts", key, next)
    const session = selectedSession()
    if (project && session && isLocalDraft(session)) {
      syncDraftSessionMeta(handle, project.path, session.id, next.composer)
      persistDraftSessions(handle, !hasContent)
    }
  }

  const setAttachments = (next: ComposerAttachment[]) => writeDraft({ attachments: next })

  const mergeAttachments = (extra: ComposerAttachment[]) => {
    const next = [...attachments()]
    for (const item of extra) {
      if (next.some((entry) => entry.url === item.url)) continue
      next.push(item)
    }
    setAttachments(next)
  }

  const busy = () => {
    const session = selectedSession()
    const sending = Boolean(state.sendingBySession[sendingKey(session?.id, state.selectedProjectId)])
    if (!session) return sending
    return isSessionBusy(state.status[session.id], Boolean(state.sendingBySession[session.id]) || sending)
  }

  const blocked = () => {
    const sessionId = state.selectedSessionId
    if (!sessionId) return false
    return Boolean(
      Object.values(state.permissions).some((item) => item.sessionID === sessionId) ||
        Object.values(state.questions).some((item) => item.sessionID === sessionId),
    )
  }

  const queuedFor = (sessionID: string | null | undefined) =>
    (sessionID ? state.queuedBySession[sessionID] : undefined) ?? []

  const promptSession = async (
    session: { id: string },
    project: Project,
    payload: {
      text: string
      files: ComposerAttachment[]
      model: { providerID: string; modelID: string }
      agent: string
      variant?: string | null
    },
  ) => {
    await applySessionPermission(handle, project.path, session.id)
    setState("status", session.id, { type: "busy" })
    setState("sessionErrors", session.id, false)
    setState("sessionErrorText", session.id, "")
    try {
      await client.promptAsync(project.path, session.id, {
        text: payload.text,
        model: payload.model,
        agent: payload.agent,
        variant: payload.variant ?? undefined,
        files: payload.files,
      })
    } catch (error) {
      if (state.status[session.id]?.type === "busy") setState("status", session.id, { type: "idle" })
      throw error
    }
  }

  const ensureProjectDirectory = (project: Project): Project | null => {
    if (isLocalProject(project)) return project
    if (project.missing) {
      setState("error", MISSING_DIRECTORY_HINT)
      return null
    }
    return project
  }

  const setSending = (key: string, value: boolean) => setState("sendingBySession", key, value)

  const queuedProject = (sessionID: string, item: QueuedMessage) =>
    (item.directory ? projectByPath(state, item.directory) : undefined) ??
    projectOwningSession(state, sessionID) ??
    selectedProject()

  const dispatchQueued = async (sessionID: string, item: QueuedMessage) => {
    if (!item.text.trim() && item.attachments.length === 0) return true
    const project = queuedProject(sessionID, item)
    if (!project) return false
    const usable = ensureProjectDirectory(project)
    if (!usable) return false
    setSending(sessionID, true)
    try {
      await promptSession({ id: sessionID }, usable, {
        text: item.text,
        files: item.attachments,
        model: item.model,
        agent: item.agent,
        variant: item.variant,
      })
      return true
    } catch (error) {
      reportError(handle, error, "发送排队消息失败", project.path)
      return false
    } finally {
      setSending(sessionID, false)
    }
  }

  const canFlush = (sessionID: string) =>
    shouldFlushQueue({
      sending: Boolean(state.sendingBySession[sessionID]),
      status: state.status[sessionID],
      permissions: state.permissions,
      questions: state.questions,
      sessionID,
    })

  const drainOne = async (sessionID: string) => {
    if (!canFlush(sessionID)) return false
    const taken = takeDeferredSend(refs.sendAfterIdle, refs.skipQueueFlush, sessionID)
    if (taken.kind === "skip") return false
    if (taken.kind === "deferred") {
      const ok = await dispatchQueued(sessionID, taken.item)
      if (!ok) setState("queuedBySession", sessionID, [taken.item, ...queuedFor(sessionID)])
      return ok && canFlush(sessionID) && (queuedFor(sessionID).length > 0 || Boolean(refs.sendAfterIdle[sessionID]))
    }
    const [next, ...rest] = queuedFor(sessionID)
    if (!next) return false
    setState("queuedBySession", sessionID, rest)
    const ok = await dispatchQueued(sessionID, next)
    if (!ok) setState("queuedBySession", sessionID, [next, ...queuedFor(sessionID)])
    return ok && canFlush(sessionID) && (queuedFor(sessionID).length > 0 || Boolean(refs.sendAfterIdle[sessionID]))
  }

  const flushQueue = async (sessionID: string) => {
    let again = false
    await withSessionLock(refs.flushing, sessionID, async () => {
      again = await drainOne(sessionID)
    })
    if (again) await flushQueue(sessionID)
  }

  return {
    busy,
    blocked,
    composer,
    attachments,
    setComposer: (value) => writeDraft({ composer: value }),
    flushQueue,
    send: async (text) => {
      const content = (text ?? composer()).trim()
      const project = selectedProject()
      const files = attachments()
      const originSessionId = state.selectedSessionId
      const originKey = activeDraftKey()
      const clearSentDraft = (sentSessionId?: string) => {
        setState("drafts", originKey, emptySessionDraft())
        if (!sentSessionId) return
        const sentKey = `session:${sentSessionId}`
        if (sentKey !== originKey) setState("drafts", sentKey, emptySessionDraft())
      }
      if (!project) {
        setState("error", "无法确定工作目录")
        return
      }
      if (!content && files.length === 0) return
      if (blocked()) return

      const model = selectedModelOf(state)
      if (!model) {
        setState("error", "请先配置一个模型")
        setState({ modelMenuOpen: false, modelSettingsOpen: true, modelSettingsError: null })
        return
      }

      const usable = ensureProjectDirectory(project)
      if (!usable) return

      if (busy()) {
        const session = selectedSession()
        if (!session || isLocalDraft(session)) return
        setState("queuedBySession", session.id, [
          ...queuedFor(session.id),
          {
            id: uid("q"),
            text: content,
            attachments: files,
            agent: currentAgent(),
            model: { providerID: model.providerID, modelID: model.modelID },
            variant: state.selectedVariant,
            directory: usable.path,
          },
        ])
        clearSentDraft()
        return
      }

      let key = sendingKey(selectedSession()?.id, project.id)
      setSending(key, true)
      setState("error", null)
      try {
        let session = selectedSession()
        const local = isLocalDraft(session) ? session : null
        if (!session || local) {
          const plan = local ? (state.planModeBySession[local.id] ?? false) : state.draftPlanMode
          session = await client.createSession(
            usable.path,
            model,
            currentAgent(),
            rulesetForProject(usable, state.permissionMode),
          )
          if (local) {
            const bundle = state.drafts[`session:${local.id}`] ?? emptySessionDraft()
            adoptDraftIntoBackendSession(handle, local.id)
            setState("drafts", `session:${session.id}`, bundle)
          }
          setState("sessionsByProject", usable.path, (list = []) => upsertById(list, session!))
          setState("planModeBySession", session.id, plan)
          if (state.selectedSessionId === originSessionId) {
            setState({ selectedSessionId: session.id, draft: false, draftPlanMode: false })
          }
          persistDraftSessions(handle, true)
          setSending(key, false)
          key = sendingKey(session.id, project.id)
          setSending(key, true)
        }
        await promptSession(session, usable, {
          text: content,
          files,
          model,
          agent: currentAgent(),
          variant: state.selectedVariant,
        })
        clearSentDraft(session.id)
      } catch (error) {
        reportError(handle, error, "发送失败", usable.path)
      } finally {
        setSending(key, false)
        if (!key.startsWith("__draft:")) void flushQueue(key)
      }
    },
    abort: async () => {
      const session = selectedSession()
      const project = selectedProject()
      if (!session || !project || isLocalDraft(session)) return
      refs.skipQueueFlush[session.id] = true
      delete refs.sendAfterIdle[session.id]
      try {
        await client.abortSession(project.path, session.id)
      } catch (error) {
        refs.skipQueueFlush[session.id] = false
        reportError(handle, error, "停止失败")
      }
    },
    revertToMessage: async (messageID) => {
      const session = selectedSession()
      const project = selectedProject()
      if (!session || !project || busy() || isLocalDraft(session)) return
      const usable = ensureProjectDirectory(project)
      if (!usable) return
      try {
        const updated = await client.revertSession(usable.path, session.id, messageID)
        const directory = directoryFor(state, session, usable)
        setState("sessionsByProject", directory, (list = []) => upsertById(list, { ...updated, directory }))
        const draft = revertDraftFromParts(state.parts[messageID] ?? [])
        setState("drafts", draftKey(session.id, state.selectedProjectId), {
          composer: draft.text,
          attachments: draft.attachments,
        })
      } catch (error) {
        reportError(handle, error, "回滚失败")
      }
    },
    sendQueuedNow: async (id) => {
      const session = selectedSession()
      const project = selectedProject()
      if (!session || !project || isLocalDraft(session)) return
      const list = queuedFor(session.id)
      const item = list.find((entry) => entry.id === id)
      if (!item) return
      const idle = shouldFlushQueue({
        sending: Boolean(state.sendingBySession[session.id]),
        status: state.status[session.id],
        permissions: state.permissions,
        questions: state.questions,
        sessionID: session.id,
      })
      if (idle) {
        const sent = await withSessionLock(refs.flushing, session.id, async () => {
          setState(
            "queuedBySession",
            session.id,
            list.filter((entry) => entry.id !== id),
          )
          return dispatchQueued(session.id, item)
        })
        if (sent === undefined) return
        if (!sent) setState("queuedBySession", session.id, [item, ...queuedFor(session.id)])
        return
      }
      const previous = refs.sendAfterIdle[session.id]
      const without = list.filter((entry) => entry.id !== id)
      setState(
        "queuedBySession",
        session.id,
        previous && previous.id !== id ? [previous, ...without.filter((entry) => entry.id !== previous.id)] : without,
      )
      refs.skipQueueFlush[session.id] = false
      refs.sendAfterIdle[session.id] = item
      try {
        await client.abortSession(project.path, session.id)
      } catch (error) {
        if (refs.sendAfterIdle[session.id]?.id === item.id) {
          delete refs.sendAfterIdle[session.id]
          setState("queuedBySession", session.id, [item, ...queuedFor(session.id).filter((entry) => entry.id !== item.id)])
        }
        reportError(handle, error, "停止失败")
      }
    },
    editQueued: (id) => {
      const sessionID = state.selectedSessionId
      if (!sessionID) return
      const item = queuedFor(sessionID).find((entry) => entry.id === id)
      if (!item) return
      const remaining = queuedFor(sessionID).filter((entry) => entry.id !== id)
      const currentText = composer().trim()
      const currentFiles = attachments()
      if (currentText || currentFiles.length > 0) {
        const model = selectedModelOf(state)
        remaining.push({
          id: uid("q"),
          text: currentText,
          attachments: currentFiles,
          agent: currentAgent(),
          model: model ? { providerID: model.providerID, modelID: model.modelID } : item.model,
          variant: state.selectedVariant,
          directory: selectedProject()?.path ?? item.directory,
        })
      }
      setState("queuedBySession", sessionID, remaining)
      writeDraft({ composer: item.text, attachments: item.attachments })
    },
    removeQueued: (id) => {
      const sessionID = state.selectedSessionId
      if (!sessionID) return
      setState(
        "queuedBySession",
        sessionID,
        queuedFor(sessionID).filter((entry) => entry.id !== id),
      )
    },
    replyPermission: async (id, reply) => {
      const lock = `perm:${id}`
      if (replying.has(lock)) return
      const permission = state.permissions[id]
      const project = selectedProject()
      if (!permission || !project) return
      replying.add(lock)
      try {
        await client.replyPermission(project.path, id, reply)
        setState(
          produce((draft) => {
            delete draft.permissions[id]
          }),
        )
      } catch (error) {
        reportError(handle, error, "回复权限失败")
      } finally {
        replying.delete(lock)
      }
    },
    replyQuestion: async (id, answers) => {
      const lock = `question:${id}`
      if (replying.has(lock)) return
      const question = state.questions[id]
      const project = selectedProject()
      if (!question || !project) return
      replying.add(lock)
      try {
        await client.replyQuestion(project.path, id, answers)
        setState(
          produce((draft) => {
            delete draft.questions[id]
          }),
        )
      } catch (error) {
        reportError(handle, error, "提交回答失败")
      } finally {
        replying.delete(lock)
      }
    },
    rejectQuestion: async (id) => {
      const lock = `question:${id}`
      if (replying.has(lock)) return
      const question = state.questions[id]
      const project = selectedProject()
      if (!question || !project) return
      replying.add(lock)
      try {
        await client.rejectQuestion(project.path, id)
        setState(
          produce((draft) => {
            delete draft.questions[id]
          }),
        )
      } catch (error) {
        reportError(handle, error, "跳过问题失败")
      } finally {
        replying.delete(lock)
      }
    },
    addFiles: async () => {
      setState("plusMenuOpen", false)
      const picked = await pickFiles()
      if (picked === "fallback") {
        const files = await pickBrowserFiles()
        if (!files.length) return
        const extra: ComposerAttachment[] = []
        for (const file of files) extra.push(await attachmentFromBrowserFile(file))
        mergeAttachments(extra)
        return
      }
      if (!picked.length) return
      mergeAttachments(picked.map((path) => attachmentFromPath(path, "file")))
    },
    addFolder: async () => {
      setState("plusMenuOpen", false)
      const picked = await pickAttachmentFolder()
      if (picked === "fallback") {
        const files = await pickBrowserFiles({ directory: true })
        if (!files.length) return
        const extra: ComposerAttachment[] = []
        for (const file of files) extra.push(await attachmentFromBrowserFile(file))
        mergeAttachments(extra)
        return
      }
      if (!picked) return
      mergeAttachments([attachmentFromPath(picked, "directory")])
    },
    removeAttachment: (id) => {
      setAttachments(attachments().filter((item) => item.id !== id))
    },
    messages: () => {
      const id = state.selectedSessionId
      if (!id) return []
      return cutAtRevert(state.messages[id] ?? [], selectedSession()?.revert)
    },
    sessionError: () => {
      const id = state.selectedSessionId
      if (!id) return ""
      return state.sessionErrorText[id] ?? ""
    },
    partsByMessage: () => state.parts,
    todos: () => {
      const id = state.selectedSessionId
      if (!id) return []
      return state.todos[id] ?? []
    },
    hasPlan: () => {
      const id = state.selectedSessionId
      if (!id) return false
      return (state.todos[id] ?? []).length > 0
    },
    pendingPermissions: () => {
      const sessionId = state.selectedSessionId
      if (!sessionId) return []
      return Object.values(state.permissions).filter((item) => item && item.sessionID === sessionId)
    },
    pendingQuestions: () => {
      const sessionId = state.selectedSessionId
      if (!sessionId) return []
      return Object.values(state.questions).filter((item) => item && item.sessionID === sessionId)
    },
    queued: () => {
      const id = state.selectedSessionId
      if (!id) return []
      return state.queuedBySession[id] ?? []
    },
    sessionDot: (sessionID) =>
      sessionDotKind({
        sessionID,
        permissions: state.permissions,
        questions: state.questions,
        sessionErrors: state.sessionErrors,
        status: state.status[sessionID],
        attention: state.attention[sessionID],
      }),
  }
}
