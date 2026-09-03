import {
  createContext,
  createEffect,
  onCleanup,
  onMount,
  useContext,
  type ParentProps,
} from "solid-js"
import { createStore, produce, type SetStoreFunction } from "solid-js/store"
import * as api from "../lib/api"
import { eventProps, subscribeEvents } from "../lib/events"
import {
  createConfiguredModel,
  discoveredFromProviderList,
  formatVariantLabel,
  loadConfiguredModels,
  loadPinnedModelKeys,
  loadSelectedModelKey,
  mergeSelectables,
  resolveSelectedKey,
  saveConfiguredModels,
  savePinnedModelKeys,
  saveSelectedModelKey,
  toBackendPatch,
  updateConfiguredModel,
  variantsByKey,
  type ConfiguredModel,
  type ModelForm,
  type SelectableModel,
} from "../lib/models"
import { PLAN_AGENT, DEFAULT_AGENT } from "../lib/config"
import {
  autoReplyForMode,
  loadPermissionMode,
  permissionPreset,
  permissionRuleset,
  savePermissionMode,
  type PermissionMode,
} from "../lib/permissions"
import {
  attachmentFromBrowserFile,
  attachmentFromPath,
  type ComposerAttachment,
} from "../lib/attachments"
import {
  loadSendShortcut,
  saveSendShortcut,
  type SendShortcut,
} from "../lib/settings"
import {
  clearLastProject,
  createProject,
  loadLastProject,
  loadProjects,
  pickAttachmentFolder,
  pickBrowserFiles,
  pickDirectory,
  pickFiles,
  saveLastProject,
  saveProjects,
} from "../lib/persist"
import type {
  Message,
  Part,
  PermissionRequest,
  Project,
  QuestionRequest,
  Session,
  SessionStatus,
  TextPart,
  Todo,
  ToolPart,
} from "../lib/types"

export type ConnectionState = "connecting" | "connected" | "disconnected"

export type QueuedMessage = {
  id: string
  text: string
  attachments: ComposerAttachment[]
  agent: string
  model: { providerID: string; modelID: string }
  variant: string | null
}

export type AppState = {
  connection: ConnectionState
  projects: Project[]
  sessionsByProject: Record<string, Session[]>
  selectedProjectId: string | null
  selectedSessionId: string | null
  draft: boolean
  messages: Record<string, Message[]>
  parts: Record<string, Part[]>
  status: Record<string, SessionStatus>
  attention: Record<string, boolean>
  todos: Record<string, Todo[]>
  permissions: Record<string, PermissionRequest>
  questions: Record<string, QuestionRequest>
  sending: boolean
  composer: string
  error: string | null
  configuredModels: ConfiguredModel[]
  selectedModelKey: string | null
  discoveredModels: SelectableModel[]
  pinnedModelKeys: string[]
  modelMenuOpen: boolean
  modelSettingsOpen: boolean
  modelSettingsError: string | null
  planMode: boolean
  plusMenuOpen: boolean
  variantMenuOpen: boolean
  permissionMenuOpen: boolean
  permissionMode: PermissionMode
  settingsOpen: boolean
  sendShortcut: SendShortcut
  selectedVariant: string | null
  modelVariants: Record<string, string[]>
  attachments: ComposerAttachment[]
  queuedBySession: Record<string, QueuedMessage[]>
}

type AppContextValue = {
  state: AppState
  setState: SetStoreFunction<AppState>
  selectedProject: () => Project | undefined
  selectedSession: () => Session | undefined
  busy: () => boolean
  blocked: () => boolean
  selectableModels: () => SelectableModel[]
  selectedModel: () => SelectableModel | undefined
  selectModel: (key: string) => void
  openModelMenu: () => void
  closeModelMenu: () => void
  openModelSettings: () => void
  closeModelSettings: () => void
  saveConfiguredModel: (form: ModelForm, editingId?: string) => Promise<void>
  saveConfiguredProvider: (form: ModelForm, modelIDs: string[]) => Promise<void>
  deleteConfiguredModel: (id: string) => Promise<void>
  pinDiscoveredModel: (key: string) => void
  unpinDiscoveredModel: (key: string) => void
  refreshDiscovered: () => Promise<void>
  currentAgent: () => string
  currentVariants: () => string[]
  variantLabel: () => string
  setPlanMode: (on: boolean) => void
  openPlusMenu: () => void
  closePlusMenu: () => void
  openVariantMenu: () => void
  closeVariantMenu: () => void
  setVariant: (value: string | null) => void
  permissionLabel: () => string
  openPermissionMenu: () => void
  closePermissionMenu: () => void
  setPermissionMode: (mode: PermissionMode) => Promise<void>
  openSettings: () => void
  closeSettings: () => void
  setSendShortcut: (shortcut: SendShortcut) => void
  addFiles: () => Promise<void>
  addFolder: () => Promise<void>
  removeAttachment: (id: string) => void
  addProject: () => Promise<void>
  toggleProject: (id: string) => void
  selectProject: (id: string) => void
  removeProject: (id: string) => void
  closeProject: () => void
  startDraft: () => void
  selectSession: (session: Session) => Promise<void>
  renameSession: (session: Session, title: string) => Promise<void>
  deleteSession: (session: Session) => Promise<void>
  send: (text?: string) => Promise<void>
  abort: () => Promise<void>
  sendQueuedNow: (id: string) => Promise<void>
  editQueued: (id: string) => void
  removeQueued: (id: string) => void
  replyPermission: (id: string, reply: "once" | "always" | "reject") => Promise<void>
  replyQuestion: (id: string, answers: string[][]) => Promise<void>
  rejectQuestion: (id: string) => Promise<void>
}

const AppContext = createContext<AppContextValue>()

function upsertById<T extends { id: string }>(list: T[], item: T) {
  const index = list.findIndex((entry) => entry.id === item.id)
  if (index === -1) return [...list, item]
  const next = list.slice()
  next[index] = item
  return next
}

function queueId() {
  return `q_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}

function sessionTitle(text: string) {
  const line = text.trim().split("\n")[0] ?? "新会话"
  return line.length > 42 ? `${line.slice(0, 42)}…` : line
}

const initial: AppState = {
  connection: "connecting",
  projects: [],
  sessionsByProject: {},
  selectedProjectId: null,
  selectedSessionId: null,
  draft: true,
  messages: {},
  parts: {},
  status: {},
  attention: {},
  todos: {},
  permissions: {},
  questions: {},
  sending: false,
  composer: "",
  error: null,
  configuredModels: [],
  selectedModelKey: null,
  discoveredModels: [],
  pinnedModelKeys: [],
  modelMenuOpen: false,
  modelSettingsOpen: false,
  modelSettingsError: null,
  planMode: false,
  plusMenuOpen: false,
  variantMenuOpen: false,
  permissionMenuOpen: false,
  permissionMode: loadPermissionMode(),
  settingsOpen: false,
  sendShortcut: loadSendShortcut(),
  selectedVariant: null,
  modelVariants: {},
  attachments: [],
  queuedBySession: {},
}

export function AppProvider(props: ParentProps) {
  const [state, setState] = createStore<AppState>(initial)
  let skipQueueFlush = false
  let sendAfterIdle: QueuedMessage | null = null

  const selectedProject = () => state.projects.find((project) => project.id === state.selectedProjectId)

  const selectedSession = () => {
    const project = selectedProject()
    if (!project || !state.selectedSessionId) return undefined
    return (state.sessionsByProject[project.path] ?? []).find((session) => session.id === state.selectedSessionId)
  }

  const busy = () => {
    const session = selectedSession()
    if (!session) return false
    return state.status[session.id]?.type === "busy" || state.sending
  }

  const selectableModels = () =>
    mergeSelectables(
      state.configuredModels,
      state.discoveredModels.filter((item) => state.pinnedModelKeys.includes(item.key)),
    )

  const selectedModel = () => selectableModels().find((item) => item.key === state.selectedModelKey)

  const persistSelection = (key: string | null) => {
    setState("selectedModelKey", key)
    saveSelectedModelKey(key)
  }

  const applyConfiguredModels = async (models: ConfiguredModel[], preferredKey?: string | null) => {
    const extras = state.discoveredModels.filter((item) => state.pinnedModelKeys.includes(item.key))
    const selectables = mergeSelectables(models, extras)
    const nextKey = resolveSelectedKey(models, selectables, preferredKey ?? state.selectedModelKey)
    setState("configuredModels", models)
    persistSelection(nextKey)
    saveConfiguredModels(models)
    const patch = toBackendPatch(models, nextKey)
    if (!patch) return
    await api.patchGlobalConfig(patch)
  }

  const refreshDiscovered = async () => {
    try {
      const list = await api.listProviders(selectedProject()?.path)
      const discovered = discoveredFromProviderList(list)
      setState("discoveredModels", discovered)
      setState("modelVariants", variantsByKey(list))
      const extras = discovered.filter((item) => state.pinnedModelKeys.includes(item.key))
      const nextKey = resolveSelectedKey(
        state.configuredModels,
        mergeSelectables(state.configuredModels, extras),
        state.selectedModelKey,
      )
      persistSelection(nextKey)
    } catch {
      setState("discoveredModels", [])
    }
  }

  const selectModel = (key: string) => {
    persistSelection(key)
    const variants = state.modelVariants[key] ?? []
    const nextVariant = state.selectedVariant && variants.includes(state.selectedVariant) ? state.selectedVariant : null
    setState({
      modelMenuOpen: false,
      variantMenuOpen: false,
      permissionMenuOpen: false,
      selectedVariant: nextVariant,
    })
  }

  const openModelMenu = () => {
    setState({
      modelMenuOpen: true,
      plusMenuOpen: false,
      variantMenuOpen: false,
      permissionMenuOpen: false,
    })
    void refreshDiscovered()
  }
  const closeModelMenu = () => setState("modelMenuOpen", false)

  const currentAgent = () => (state.planMode ? PLAN_AGENT : DEFAULT_AGENT)

  const currentVariants = () => {
    const key = state.selectedModelKey
    if (!key) return []
    return state.modelVariants[key] ?? selectedModel()?.variants ?? []
  }

  const variantLabel = () => formatVariantLabel(state.selectedVariant ?? "default")

  const setPlanMode = (on: boolean) => {
    setState({
      planMode: on,
      plusMenuOpen: false,
    })
  }

  const openPlusMenu = () =>
    setState({
      plusMenuOpen: true,
      modelMenuOpen: false,
      variantMenuOpen: false,
      permissionMenuOpen: false,
    })
  const closePlusMenu = () => setState("plusMenuOpen", false)

  const openVariantMenu = () =>
    setState({
      variantMenuOpen: true,
      plusMenuOpen: false,
      modelMenuOpen: false,
      permissionMenuOpen: false,
    })
  const closeVariantMenu = () => setState("variantMenuOpen", false)

  const permissionLabel = () => permissionPreset(state.permissionMode).label

  const openPermissionMenu = () =>
    setState({
      permissionMenuOpen: true,
      plusMenuOpen: false,
      modelMenuOpen: false,
      variantMenuOpen: false,
    })
  const closePermissionMenu = () => setState("permissionMenuOpen", false)

  const openSettings = () => {
    setState({
      settingsOpen: true,
      modelMenuOpen: false,
      plusMenuOpen: false,
      variantMenuOpen: false,
      permissionMenuOpen: false,
    })
  }

  const closeSettings = () => setState("settingsOpen", false)

  const setSendShortcut = (shortcut: SendShortcut) => {
    setState("sendShortcut", shortcut)
    saveSendShortcut(shortcut)
  }

  const applySessionPermission = async (directory: string, sessionID: string, mode = state.permissionMode) => {
    await api.updateSessionPermission(directory, sessionID, permissionRuleset(mode))
  }

  const autoReplyPending = async (mode: PermissionMode, sessionID?: string) => {
    const project = selectedProject()
    if (!project) return
    const pending = Object.values(state.permissions).filter(
      (item) => item && (!sessionID || item.sessionID === sessionID),
    )
    for (const item of pending) {
      const reply = autoReplyForMode(mode, item.permission)
      if (!reply) continue
      await api.replyPermission(project.path, item.id, reply)
      setState(
        produce((draft) => {
          delete draft.permissions[item.id]
        }),
      )
    }
  }

  const setPermissionMode = async (mode: PermissionMode) => {
    setState({
      permissionMode: mode,
      permissionMenuOpen: false,
    })
    savePermissionMode(mode)
    const session = selectedSession()
    const project = selectedProject()
    if (session && project) {
      try {
        await applySessionPermission(project.path, session.id, mode)
        await autoReplyPending(mode, session.id)
      } catch (error) {
        setState("error", error instanceof Error ? error.message : "更新权限失败")
      }
    }
  }

  const setVariant = (value: string | null) => {
    setState({
      selectedVariant: value,
      variantMenuOpen: false,
    })
  }

  const addFiles = async () => {
    setState("plusMenuOpen", false)
    const picked = await pickFiles()
    if (picked === "fallback") {
      const files = await pickBrowserFiles()
      if (!files.length) return
      const extra: ComposerAttachment[] = []
      for (const file of files) extra.push(await attachmentFromBrowserFile(file))
      setState("attachments", [...state.attachments, ...extra])
      return
    }
    if (!picked.length) return
    const next = [...state.attachments]
    for (const path of picked) {
      const item = attachmentFromPath(path, "file")
      if (next.some((entry) => entry.url === item.url)) continue
      next.push(item)
    }
    setState("attachments", next)
  }

  const addFolder = async () => {
    setState("plusMenuOpen", false)
    const picked = await pickAttachmentFolder()
    if (picked === "fallback") {
      const files = await pickBrowserFiles({ directory: true })
      if (!files.length) return
      const extra: ComposerAttachment[] = []
      for (const file of files) extra.push(await attachmentFromBrowserFile(file))
      setState("attachments", [...state.attachments, ...extra])
      return
    }
    if (!picked) return
    const item = attachmentFromPath(picked, "directory")
    if (state.attachments.some((entry) => entry.url === item.url)) return
    setState("attachments", [...state.attachments, item])
  }

  const removeAttachment = (id: string) => {
    setState(
      "attachments",
      state.attachments.filter((item) => item.id !== id),
    )
  }

  const openModelSettings = () => {
    setState({
      modelMenuOpen: false,
      modelSettingsOpen: true,
      modelSettingsError: null,
    })
  }

  const closeModelSettings = () => {
    setState({
      modelSettingsOpen: false,
      modelSettingsError: null,
    })
  }

  const saveConfiguredModel = async (form: ModelForm, editingId?: string) => {
    setState("modelSettingsError", null)
    const next = editingId
      ? state.configuredModels.map((item) => (item.id === editingId ? updateConfiguredModel(item, form) : item))
      : [...state.configuredModels, createConfiguredModel(form)]
    const saved = editingId ? next.find((item) => item.id === editingId) : next[next.length - 1]
    try {
      await applyConfiguredModels(next, saved ? `${saved.providerID}/${saved.modelID}` : null)
      setState("modelSettingsOpen", false)
    } catch (error) {
      setState("modelSettingsError", error instanceof Error ? error.message : "同步到后端失败")
    }
  }

  const saveConfiguredProvider = async (form: ModelForm, modelIDs: string[]) => {
    setState("modelSettingsError", null)
    const unique = [...new Set(modelIDs.map((item) => item.trim()).filter(Boolean))]
    if (unique.length === 0) {
      setState("modelSettingsError", "请至少勾选一个模型")
      return
    }
    const sample = createConfiguredModel({ ...form, modelID: unique[0], name: unique[0] })
    const providerID = sample.providerID
    const existing = new Map(state.configuredModels.map((item) => [`${item.providerID}/${item.modelID}`, item]))
    const others = state.configuredModels.filter((item) => item.providerID !== providerID)
    const nextModels = unique.map((modelID) => {
      const created = createConfiguredModel({
        ...form,
        providerID,
        providerName: form.providerName.trim() || sample.providerName,
        modelID,
        name: modelID,
      })
      const prev = existing.get(`${providerID}/${modelID}`)
      return prev ? { ...created, id: prev.id, name: prev.name === prev.modelID ? modelID : prev.name } : created
    })
    try {
      await applyConfiguredModels([...others, ...nextModels], `${providerID}/${unique[0]}`)
      setState("modelSettingsOpen", false)
    } catch (error) {
      setState("modelSettingsError", error instanceof Error ? error.message : "同步到后端失败")
    }
  }

  const deleteConfiguredModel = async (id: string) => {
    const next = state.configuredModels.filter((item) => item.id !== id)
    try {
      await applyConfiguredModels(next)
    } catch (error) {
      setState("modelSettingsError", error instanceof Error ? error.message : "删除后同步失败")
    }
  }

  const pinDiscoveredModel = (key: string) => {
    if (state.pinnedModelKeys.includes(key)) {
      persistSelection(key)
      return
    }
    const keys = [...state.pinnedModelKeys, key]
    setState("pinnedModelKeys", keys)
    savePinnedModelKeys(keys)
    persistSelection(key)
  }

  const unpinDiscoveredModel = (key: string) => {
    const keys = state.pinnedModelKeys.filter((item) => item !== key)
    setState("pinnedModelKeys", keys)
    savePinnedModelKeys(keys)
    if (state.selectedModelKey === key) {
      persistSelection(resolveSelectedKey(state.configuredModels, selectableModels(), null))
    }
  }

  const blocked = () => {
    const sessionId = state.selectedSessionId
    if (!sessionId) return false
    return Boolean(
      Object.values(state.permissions).some((item) => item.sessionID === sessionId) ||
        Object.values(state.questions).some((item) => item.sessionID === sessionId),
    )
  }

  async function refreshProjectSessions(project: Project) {
    try {
      const sessions = await api.listSessions(project.path)
      const roots = (sessions ?? []).filter((session) => !session.parentID && !session.time.archived)
      setState("sessionsByProject", project.path, roots)
    } catch (error) {
      setState("error", error instanceof Error ? error.message : "加载会话失败")
    }
  }

  async function loadSessionDetail(session: Session) {
    const [messages, todos, permissions, questions] = await Promise.all([
      api.listMessages(session.directory, session.id),
      api.listTodos(session.directory, session.id).catch(() => [] as Todo[]),
      api.listPermissions(session.directory).catch(() => [] as PermissionRequest[]),
      api.listQuestions(session.directory).catch(() => [] as QuestionRequest[]),
    ])

    setState(
      produce((draft) => {
        draft.messages[session.id] = messages.map((item) => item.info)
        for (const item of messages) {
          draft.parts[item.info.id] = item.parts ?? []
        }
        draft.todos[session.id] = todos ?? []
        for (const permission of permissions ?? []) {
          if (permission.sessionID === session.id) draft.permissions[permission.id] = permission
        }
        for (const question of questions ?? []) {
          if (question.sessionID === session.id) draft.questions[question.id] = question
        }
      }),
    )
  }

  const addProject = async () => {
    const path = await pickDirectory()
    if (!path) return
    const existing = state.projects.find((project) => project.path === path)
    if (existing) {
      setState("selectedProjectId", existing.id)
      setState(
        "projects",
        state.projects.map((project) => (project.id === existing.id ? { ...project, expanded: true } : project)),
      )
      saveLastProject(existing.id)
      await refreshProjectSessions(existing)
      return
    }
    const project = createProject(path)
    const projects = [...state.projects, project]
    setState("projects", projects)
    setState("selectedProjectId", project.id)
    setState("draft", true)
    setState("selectedSessionId", null)
    saveProjects(projects)
    saveLastProject(project.id)
    await refreshProjectSessions(project)
  }

  const toggleProject = (id: string) => {
    const projects = state.projects.map((project) =>
      project.id === id ? { ...project, expanded: !project.expanded } : project,
    )
    setState("projects", projects)
    saveProjects(projects)
  }

  const selectProject = (id: string) => {
    setState("selectedProjectId", id)
    saveLastProject(id)
  }

  const removeProject = (id: string) => {
    const removed = state.projects.find((project) => project.id === id)
    const projects = state.projects.filter((project) => project.id !== id)
    setState("projects", projects)
    if (removed) {
      for (const session of state.sessionsByProject[removed.path] ?? []) {
        setState("attention", session.id, false)
      }
    }
    saveProjects(projects)
    if (state.selectedProjectId === id) {
      setState({
        selectedProjectId: projects[0]?.id ?? null,
        selectedSessionId: null,
        draft: true,
        error: null,
      })
      if (projects[0]) saveLastProject(projects[0].id)
      else clearLastProject()
    }
  }

  const closeProject = () => {
    setState({
      selectedProjectId: null,
      selectedSessionId: null,
      draft: true,
      error: null,
    })
    clearLastProject()
  }

  const renameSession = async (session: Session, title: string) => {
    const trimmed = title.trim()
    if (!trimmed || trimmed === session.title) return
    try {
      const updated = await api.updateSessionTitle(session.directory, session.id, trimmed)
      setState("sessionsByProject", session.directory, (list = []) =>
        list.map((item) => (item.id === session.id ? updated : item)),
      )
    } catch (error) {
      setState("error", error instanceof Error ? error.message : "重命名失败")
    }
  }

  const deleteSession = async (session: Session) => {
    try {
      await api.deleteSession(session.directory, session.id)
      setState("sessionsByProject", session.directory, (list = []) =>
        list.filter((item) => item.id !== session.id),
      )
      if (state.selectedSessionId === session.id) {
        setState({
          selectedSessionId: null,
          draft: true,
        })
      }
      setState("attention", session.id, false)
      setState("queuedBySession", session.id, [])
    } catch (error) {
      setState("error", error instanceof Error ? error.message : "删除会话失败")
    }
  }

  const startDraft = () => {
    if (!selectedProject()) return
    setState({
      selectedSessionId: null,
      draft: true,
      composer: "",
      error: null,
    })
  }

  const selectSession = async (session: Session) => {
    const project = state.projects.find((item) => item.path === session.directory)
    setState({
      selectedSessionId: session.id,
      selectedProjectId: project?.id ?? state.selectedProjectId,
      draft: false,
      error: null,
    })
    setState("attention", session.id, false)
    if (project) saveLastProject(project.id)
    await loadSessionDetail(session)
  }

  const queuedFor = (sessionID: string | null | undefined) =>
    (sessionID ? state.queuedBySession[sessionID] : undefined) ?? []

  const promptSession = async (
    session: Session,
    project: Project,
    payload: {
      text: string
      files: ComposerAttachment[]
      model: { providerID: string; modelID: string }
      agent: string
      variant?: string | null
    },
  ) => {
    await applySessionPermission(project.path, session.id)
    await api.promptAsync(project.path, session.id, {
      text: payload.text,
      model: payload.model,
      agent: payload.agent,
      variant: payload.variant ?? undefined,
      files: payload.files,
    })
    setState("status", session.id, { type: "busy" })
  }

  const dispatchQueued = async (sessionID: string, item: QueuedMessage) => {
    const project =
      selectedProject() ??
      state.projects.find((entry) => (state.sessionsByProject[entry.path] ?? []).some((session) => session.id === sessionID))
    const session = project
      ? (state.sessionsByProject[project.path] ?? []).find((entry) => entry.id === sessionID)
      : undefined
    if (!project || !session) return false
    setState("sending", true)
    try {
      await promptSession(session, project, {
        text: item.text,
        files: item.attachments,
        model: item.model,
        agent: item.agent,
        variant: item.variant,
      })
      return true
    } catch (error) {
      setState("error", error instanceof Error ? error.message : "发送排队消息失败")
      return false
    } finally {
      setState("sending", false)
    }
  }

  const flushQueue = async (sessionID: string) => {
    if (state.sending) return
    if (state.status[sessionID]?.type === "busy") return
    if (
      Object.values(state.permissions).some((item) => item?.sessionID === sessionID) ||
      Object.values(state.questions).some((item) => item?.sessionID === sessionID)
    ) {
      return
    }

    if (sendAfterIdle) {
      const item = sendAfterIdle
      sendAfterIdle = null
      skipQueueFlush = false
      const ok = await dispatchQueued(sessionID, item)
      if (!ok) {
        setState("queuedBySession", sessionID, [item, ...queuedFor(sessionID)])
      }
      return
    }

    if (skipQueueFlush) {
      skipQueueFlush = false
      return
    }

    const [next, ...rest] = queuedFor(sessionID)
    if (!next) return
    setState("queuedBySession", sessionID, rest)
    const ok = await dispatchQueued(sessionID, next)
    if (!ok) setState("queuedBySession", sessionID, [next, ...queuedFor(sessionID)])
  }

  const send = async (text?: string) => {
    const content = (text ?? state.composer).trim()
    const project = selectedProject()
    const files = state.attachments
    if (!project) {
      setState("error", "请先添加一个项目文件夹")
      return
    }
    if (!content && files.length === 0) return
    if (blocked()) return

    const model = selectedModel()
    if (!model) {
      setState("error", "请先配置一个模型")
      openModelSettings()
      return
    }

    if (busy()) {
      const session = selectedSession()
      if (!session) return
      setState("queuedBySession", session.id, [
        ...queuedFor(session.id),
        {
          id: queueId(),
          text: content,
          attachments: files,
          agent: currentAgent(),
          model: { providerID: model.providerID, modelID: model.modelID },
          variant: state.selectedVariant,
        },
      ])
      setState("composer", "")
      setState("attachments", [])
      return
    }

    setState("sending", true)
    setState("error", null)
    try {
      let session = selectedSession()
      const title = content || files[0]?.filename || "新会话"
      if (!session) {
        session = await api.createSession(
          project.path,
          sessionTitle(title),
          model,
          currentAgent(),
          permissionRuleset(state.permissionMode),
        )
        setState("sessionsByProject", project.path, (list = []) => upsertById(list, session!))
        setState({
          selectedSessionId: session.id,
          draft: false,
        })
      } else {
        await applySessionPermission(project.path, session.id)
      }
      await api.promptAsync(project.path, session.id, {
        text: content,
        model,
        agent: currentAgent(),
        variant: state.selectedVariant ?? undefined,
        files,
      })
      setState("composer", "")
      setState("attachments", [])
      setState("status", session.id, { type: "busy" })
    } catch (error) {
      setState("error", error instanceof Error ? error.message : "发送失败")
    } finally {
      setState("sending", false)
    }
  }

  const abort = async () => {
    const session = selectedSession()
    const project = selectedProject()
    if (!session || !project) return
    skipQueueFlush = true
    sendAfterIdle = null
    try {
      await api.abortSession(project.path, session.id)
    } catch (error) {
      skipQueueFlush = false
      setState("error", error instanceof Error ? error.message : "停止失败")
    }
  }

  const sendQueuedNow = async (id: string) => {
    const session = selectedSession()
    const project = selectedProject()
    if (!session || !project) return
    const list = queuedFor(session.id)
    const item = list.find((entry) => entry.id === id)
    if (!item) return
    setState(
      "queuedBySession",
      session.id,
      list.filter((entry) => entry.id !== id),
    )
    skipQueueFlush = false
    sendAfterIdle = item
    try {
      await api.abortSession(project.path, session.id)
    } catch (error) {
      sendAfterIdle = null
      setState("queuedBySession", session.id, [item, ...queuedFor(session.id)])
      setState("error", error instanceof Error ? error.message : "停止失败")
    }
  }

  const editQueued = (id: string) => {
    const sessionID = state.selectedSessionId
    if (!sessionID) return
    const item = queuedFor(sessionID).find((entry) => entry.id === id)
    if (!item) return
    const remaining = queuedFor(sessionID).filter((entry) => entry.id !== id)
    const currentText = state.composer.trim()
    const currentFiles = state.attachments
    if (currentText || currentFiles.length > 0) {
      const model = selectedModel()
      remaining.push({
        id: queueId(),
        text: currentText,
        attachments: currentFiles,
        agent: currentAgent(),
        model: model
          ? { providerID: model.providerID, modelID: model.modelID }
          : item.model,
        variant: state.selectedVariant,
      })
    }
    setState("queuedBySession", sessionID, remaining)
    setState("composer", item.text)
    setState("attachments", item.attachments)
  }

  const removeQueued = (id: string) => {
    const sessionID = state.selectedSessionId
    if (!sessionID) return
    setState(
      "queuedBySession",
      sessionID,
      queuedFor(sessionID).filter((entry) => entry.id !== id),
    )
  }

  const replyPermission = async (id: string, reply: "once" | "always" | "reject") => {
    const permission = state.permissions[id]
    const project = selectedProject()
    if (!permission || !project) return
    await api.replyPermission(project.path, id, reply)
    setState(
      produce((draft) => {
        delete draft.permissions[id]
      }),
    )
  }

  const replyQuestion = async (id: string, answers: string[][]) => {
    const question = state.questions[id]
    const project = selectedProject()
    if (!question || !project) return
    await api.replyQuestion(project.path, id, answers)
    setState(
      produce((draft) => {
        delete draft.questions[id]
      }),
    )
  }

  const rejectQuestion = async (id: string) => {
    const question = state.questions[id]
    const project = selectedProject()
    if (!question || !project) return
    await api.rejectQuestion(project.path, id)
    setState(
      produce((draft) => {
        delete draft.questions[id]
      }),
    )
  }

  onMount(() => {
    const projects = loadProjects()
    const last = loadLastProject()
    const configured = loadConfiguredModels()
    setState("projects", projects)
    setState("selectedProjectId", last && projects.some((item) => item.id === last) ? last : projects[0]?.id ?? null)
    setState("draft", true)
    setState("configuredModels", configured)
    setState("pinnedModelKeys", loadPinnedModelKeys())
    persistSelection(resolveSelectedKey(configured, mergeSelectables(configured, []), loadSelectedModelKey()))

    for (const project of projects) {
      void refreshProjectSessions(project)
    }

    const ping = window.setInterval(async () => {
      const ok = await api.healthcheck().catch(() => false)
      if (!ok) setState("connection", "disconnected")
    }, 8000)

    void (async () => {
      const ok = await api.healthcheck().catch(() => false)
      if (!ok) return
      setState("connection", "connected")
      const patch = toBackendPatch(loadConfiguredModels(), loadSelectedModelKey())
      if (patch) await api.patchGlobalConfig(patch).catch(() => undefined)
      await refreshDiscovered()
    })()

    const stop = subscribeEvents(
      (parsed) => {
        const event = parsed.event
        const props = eventProps(event)
        const directory = parsed.directory

        const autoReplies: Array<{ id: string; reply: "once" | "always" | "reject"; directory: string }> = []
        const idleSessions: string[] = []
        setState(
          produce((draft) => {
            if (event.type === "session.created" || event.type === "session.updated") {
              const info = props.info as Session | undefined
              const sessionID = (props.sessionID as string) ?? info?.id
              if (info && sessionID && !info.parentID) {
                const path = directory || info.directory
                draft.sessionsByProject[path] = upsertById(draft.sessionsByProject[path] ?? [], info)
              }
            }
            if (event.type === "session.deleted") {
              const info = props.info as Session | undefined
              const sessionID = (props.sessionID as string) ?? info?.id
              const path = directory || info?.directory
              if (sessionID && path && draft.sessionsByProject[path]) {
                draft.sessionsByProject[path] = draft.sessionsByProject[path].filter((item) => item.id !== sessionID)
              }
              if (sessionID) delete draft.attention[sessionID]
              if (draft.selectedSessionId === sessionID) {
                draft.selectedSessionId = null
                draft.draft = true
              }
              if (sessionID) delete draft.queuedBySession[sessionID]
            }
            if (event.type === "message.updated") {
              const info = props.info as Message | undefined
              const sessionID = (props.sessionID as string) ?? info?.sessionID
              if (info && sessionID) {
                draft.messages[sessionID] = upsertById(draft.messages[sessionID] ?? [], info)
              }
            }
            if (event.type === "message.removed") {
              const sessionID = props.sessionID as string
              const messageID = props.messageID as string
              if (sessionID && messageID) {
                draft.messages[sessionID] = (draft.messages[sessionID] ?? []).filter((item) => item.id !== messageID)
                delete draft.parts[messageID]
              }
            }
            if (event.type === "message.part.updated") {
              const part = props.part as Part | undefined
              if (part) {
                draft.parts[part.messageID] = upsertById(draft.parts[part.messageID] ?? [], part)
              }
            }
            if (event.type === "message.part.removed") {
              const messageID = props.messageID as string
              const partID = props.partID as string
              if (messageID && partID) {
                draft.parts[messageID] = (draft.parts[messageID] ?? []).filter((item) => item.id !== partID)
              }
            }
            if (event.type === "message.part.delta") {
              const messageID = props.messageID as string
              const partID = props.partID as string
              const field = (props.field as string) ?? "text"
              const delta = props.delta as string
              if (messageID && partID && typeof delta === "string") {
                const list = draft.parts[messageID] ?? []
                const index = list.findIndex((item) => item.id === partID)
                if (index >= 0) {
                  const current = list[index] as TextPart | ToolPart
                  if (field === "text" && "text" in current) {
                    list[index] = { ...current, text: `${current.text ?? ""}${delta}` }
                  }
                } else {
                  list.push({
                    id: partID,
                    sessionID: (props.sessionID as string) ?? "",
                    messageID,
                    type: "text",
                    text: delta,
                  })
                }
                draft.parts[messageID] = list.slice()
              }
            }
            if (event.type === "session.status") {
              const sessionID = props.sessionID as string
              const status = props.status as SessionStatus
              if (sessionID && status) draft.status[sessionID] = status
            }
            if (event.type === "session.idle") {
              const sessionID = props.sessionID as string
              if (sessionID) {
                draft.status[sessionID] = { type: "idle" }
                idleSessions.push(sessionID)
                if (draft.selectedSessionId !== sessionID) draft.attention[sessionID] = true
              }
            }
            if (event.type === "todo.updated") {
              const sessionID = props.sessionID as string
              const todos = props.todos as Todo[]
              if (sessionID) draft.todos[sessionID] = todos ?? []
            }
            if (event.type === "permission.asked") {
              const permission = (props as unknown as PermissionRequest).id
                ? (props as unknown as PermissionRequest)
                : ((props.permission ?? props.request ?? props) as PermissionRequest)
              if (permission?.id) {
                const reply = autoReplyForMode(draft.permissionMode, permission.permission)
                const path =
                  directory ||
                  Object.entries(draft.sessionsByProject).find(([, sessions]) =>
                    sessions.some((item) => item.id === permission.sessionID),
                  )?.[0]
                if (reply && path) {
                  autoReplies.push({ id: permission.id, reply, directory: path })
                } else {
                  draft.permissions[permission.id] = permission
                }
              }
            }
            if (event.type === "permission.replied") {
              const requestID = (props.requestID as string) ?? (props.id as string)
              if (requestID) delete draft.permissions[requestID]
            }
            if (event.type === "question.asked") {
              const question = (props as unknown as QuestionRequest).id
                ? (props as unknown as QuestionRequest)
                : ((props.question ?? props.request ?? props) as QuestionRequest)
              if (question?.id) draft.questions[question.id] = question
            }
            if (event.type === "question.replied" || event.type === "question.rejected") {
              const requestID = (props.requestID as string) ?? (props.id as string)
              if (requestID) delete draft.questions[requestID]
            }
            if (event.type === "session.error") {
              const message =
                (props.error as { data?: { message?: string }; message?: string } | undefined)?.data?.message ||
                (props.error as { message?: string } | undefined)?.message ||
                (props.message as string)
              if (message) draft.error = message
            }
          }),
        )
        for (const item of autoReplies) {
          void api.replyPermission(item.directory, item.id, item.reply)
        }
        for (const sessionID of new Set(idleSessions)) {
          void flushQueue(sessionID)
        }
      },
      (connected) => {
        setState("connection", connected ? "connected" : "disconnected")
        if (connected) void refreshDiscovered()
      },
    )

    onCleanup(() => {
      stop()
      window.clearInterval(ping)
    })
  })

  createEffect(() => {
    saveProjects(state.projects)
  })

  createEffect(() => {
    const selected = state.selectedVariant
    if (!selected) return
    if (!currentVariants().includes(selected)) setState("selectedVariant", null)
  })

  const value: AppContextValue = {
    state,
    setState,
    selectedProject,
    selectedSession,
    busy,
    blocked,
    selectableModels,
    selectedModel,
    selectModel,
    openModelMenu,
    closeModelMenu,
    openModelSettings,
    closeModelSettings,
    saveConfiguredModel,
    saveConfiguredProvider,
    deleteConfiguredModel,
    pinDiscoveredModel,
    unpinDiscoveredModel,
    refreshDiscovered,
    currentAgent,
    currentVariants,
    variantLabel,
    setPlanMode,
    openPlusMenu,
    closePlusMenu,
    openVariantMenu,
    closeVariantMenu,
    setVariant,
    permissionLabel,
    openPermissionMenu,
    closePermissionMenu,
    setPermissionMode,
    openSettings,
    closeSettings,
    setSendShortcut,
    addFiles,
    addFolder,
    removeAttachment,
    addProject,
    toggleProject,
    selectProject,
    removeProject,
    closeProject,
    startDraft,
    selectSession,
    renameSession,
    deleteSession,
    send,
    abort,
    sendQueuedNow,
    editQueued,
    removeQueued,
    replyPermission,
    replyQuestion,
    rejectQuestion,
  }

  return <AppContext.Provider value={value}>{props.children}</AppContext.Provider>
}

export function useApp() {
  const context = useContext(AppContext)
  if (!context) throw new Error("useApp must be used within AppProvider")
  return context
}
