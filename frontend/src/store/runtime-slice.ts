import { produce } from "solid-js/store"
import { draftKey } from "../lib/draft"
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
  activePlanMode,
  projectOwningSession,
  reportError,
  selectedProjectOf,
  selectedSessionOf,
  type StoreHandle,
} from "./handle"
import { directoryFor, sendingKey } from "./lookup"
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

  const selectedProject = () => selectedProjectOf(state)
  const selectedSession = () => selectedSessionOf(state)
  const activeDraftKey = () => draftKey(state.selectedSessionId, state.selectedProjectId)
  const currentDraft = () => state.drafts[activeDraftKey()] ?? emptySessionDraft()
  const composer = () => currentDraft().composer
  const attachments = () => currentDraft().attachments
  const currentAgent = () => (activePlanMode(state) ? PLAN_AGENT : DEFAULT_AGENT)

  const writeDraft = (patch: Partial<SessionDraft>) => {
    const key = activeDraftKey()
    const prev = state.drafts[key] ?? emptySessionDraft()
    setState("drafts", key, {
      composer: patch.composer ?? prev.composer,
      attachments: patch.attachments ?? prev.attachments,
    })
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
    await client.promptAsync(project.path, session.id, {
      text: payload.text,
      model: payload.model,
      agent: payload.agent,
      variant: payload.variant ?? undefined,
      files: payload.files,
    })
    setState("status", session.id, { type: "busy" })
    setState("sessionErrors", session.id, false)
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

  const dispatchQueued = async (sessionID: string, item: QueuedMessage) => {
    if (!item.text.trim() && item.attachments.length === 0) return true
    const project = selectedProject() ?? projectOwningSession(state, sessionID)
    const session = project
      ? (state.sessionsByProject[project.path] ?? []).find((entry) => entry.id === sessionID)
      : undefined
    if (!project || !session) return false
    const usable = ensureProjectDirectory(project)
    if (!usable) return false
    setSending(sessionID, true)
    try {
      await promptSession(session, usable, {
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

  const flushQueue = async (sessionID: string) => {
    await withSessionLock(refs.flushing, sessionID, async () => {
      if (
        !shouldFlushQueue({
          sending: Boolean(state.sendingBySession[sessionID]),
          status: state.status[sessionID],
          permissions: state.permissions,
          questions: state.questions,
          sessionID,
        })
      ) {
        return
      }

      const taken = takeDeferredSend(refs.sendAfterIdle, refs.skipQueueFlush, sessionID)
      if (taken.kind === "skip") return
      if (taken.kind === "deferred") {
        const ok = await dispatchQueued(sessionID, taken.item)
        if (!ok) setState("queuedBySession", sessionID, [taken.item, ...queuedFor(sessionID)])
        return
      }

      const [next, ...rest] = queuedFor(sessionID)
      if (!next) return
      setState("queuedBySession", sessionID, rest)
      const ok = await dispatchQueued(sessionID, next)
      if (!ok) setState("queuedBySession", sessionID, [next, ...queuedFor(sessionID)])
    })
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
      const originKey = activeDraftKey()
      const clearSentDraft = () => {
        setState("drafts", originKey, emptySessionDraft())
        const current = activeDraftKey()
        if (current !== originKey) setState("drafts", current, emptySessionDraft())
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
        if (!session) return
        setState("queuedBySession", session.id, [
          ...queuedFor(session.id),
          {
            id: uid("q"),
            text: content,
            attachments: files,
            agent: currentAgent(),
            model: { providerID: model.providerID, modelID: model.modelID },
            variant: state.selectedVariant,
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
        if (!session) {
          session = await client.createSession(
            usable.path,
            model,
            currentAgent(),
            rulesetForProject(usable, state.permissionMode),
          )
          setState("sessionsByProject", usable.path, (list = []) => upsertById(list, session!))
          setState("planModeBySession", session.id, state.draftPlanMode)
          setState({ selectedSessionId: session.id, draft: false, draftPlanMode: false })
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
        clearSentDraft()
      } catch (error) {
        reportError(handle, error, "发送失败", usable.path)
      } finally {
        setSending(key, false)
      }
    },
    abort: async () => {
      const session = selectedSession()
      const project = selectedProject()
      if (!session || !project) return
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
      if (!session || !project || busy()) return
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
      if (!session || !project) return
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
      setState(
        "queuedBySession",
        session.id,
        list.filter((entry) => entry.id !== id),
      )
      refs.skipQueueFlush[session.id] = false
      refs.sendAfterIdle[session.id] = item
      try {
        await client.abortSession(project.path, session.id)
      } catch (error) {
        delete refs.sendAfterIdle[session.id]
        setState("queuedBySession", session.id, [item, ...queuedFor(session.id)])
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
      const permission = state.permissions[id]
      const project = selectedProject()
      if (!permission || !project) return
      try {
        await client.replyPermission(project.path, id, reply)
        setState(
          produce((draft) => {
            delete draft.permissions[id]
          }),
        )
      } catch (error) {
        reportError(handle, error, "回复权限失败")
      }
    },
    replyQuestion: async (id, answers) => {
      const question = state.questions[id]
      const project = selectedProject()
      if (!question || !project) return
      try {
        await client.replyQuestion(project.path, id, answers)
        setState(
          produce((draft) => {
            delete draft.questions[id]
          }),
        )
      } catch (error) {
        reportError(handle, error, "提交回答失败")
      }
    },
    rejectQuestion: async (id) => {
      const question = state.questions[id]
      const project = selectedProject()
      if (!question || !project) return
      try {
        await client.rejectQuestion(project.path, id)
        setState(
          produce((draft) => {
            delete draft.questions[id]
          }),
        )
      } catch (error) {
        reportError(handle, error, "跳过问题失败")
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
