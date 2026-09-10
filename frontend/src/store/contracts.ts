import type { ComposerAttachment } from "../lib/attachments"
import type { ConfiguredModel, ModelForm, SelectableModel } from "../lib/models"
import type { PermissionMode } from "../lib/permissions"
import type { SendShortcut } from "../lib/settings"
import type { SessionDot } from "../lib/session-status"
import type {
  Message,
  Part,
  PermissionRequest,
  Project,
  QuestionRequest,
  Session,
  Todo,
} from "../lib/types"
import type { ConnectionState, QueuedMessage } from "./state"

export type ProjectApi = {
  projects: () => Project[]
  sessionsFor: (path: string) => Session[]
  selectedProject: () => Project | undefined
  selectedSession: () => Session | undefined
  selectedSessionId: () => string | null
  connection: () => ConnectionState
  error: () => string | null
  vcsBranch: () => string
  addProject: () => Promise<void>
  relocateProject: (id: string) => Promise<Project | null>
  toggleProject: (id: string) => void
  selectProject: (id: string) => void
  removeProject: (id: string) => void
  closeProject: () => void
  startDraft: () => void
  selectSession: (session: Session) => Promise<void>
  renameSession: (session: Session, title: string) => Promise<void>
  deleteSession: (session: Session) => Promise<void>
}

export type ModelApi = {
  selectableModels: () => SelectableModel[]
  selectedModel: () => SelectableModel | undefined
  selectedModelKey: () => string | null
  selectedVariant: () => string | null
  currentVariants: () => string[]
  variantLabel: () => string
  modelMenuOpen: () => boolean
  variantMenuOpen: () => boolean
  modelSettingsOpen: () => boolean
  modelSettingsError: () => string | null
  configuredModels: () => ConfiguredModel[]
  discoveredModels: () => SelectableModel[]
  isPinned: (key: string) => boolean
  selectModel: (key: string) => void
  openModelMenu: () => void
  closeModelMenu: () => void
  openModelSettings: () => void
  closeModelSettings: () => void
  saveConfiguredProvider: (form: ModelForm, modelIDs: string[]) => Promise<void>
  deleteConfiguredModel: (id: string) => Promise<void>
  pinDiscoveredModel: (key: string) => void
  unpinDiscoveredModel: (key: string) => void
  refreshDiscovered: () => Promise<void>
  setVariant: (value: string | null) => void
  openVariantMenu: () => void
  closeVariantMenu: () => void
  nameFor: (providerID?: string, modelID?: string) => string
}

export type RuntimeApi = {
  busy: () => boolean
  blocked: () => boolean
  composer: () => string
  attachments: () => ComposerAttachment[]
  setComposer: (value: string) => void
  send: (text?: string) => Promise<void>
  abort: () => Promise<void>
  sendQueuedNow: (id: string) => Promise<void>
  editQueued: (id: string) => void
  removeQueued: (id: string) => void
  replyPermission: (id: string, reply: "once" | "always" | "reject") => Promise<void>
  replyQuestion: (id: string, answers: string[][]) => Promise<void>
  rejectQuestion: (id: string) => Promise<void>
  addFiles: () => Promise<void>
  addFolder: () => Promise<void>
  removeAttachment: (id: string) => void
  messages: () => Message[]
  partsByMessage: () => Record<string, Part[]>
  todos: () => Todo[]
  hasPlan: () => boolean
  currentTodo: () => string
  pendingPermissions: () => PermissionRequest[]
  pendingQuestions: () => QuestionRequest[]
  queued: () => QueuedMessage[]
  sessionDot: (sessionID: string) => SessionDot | null
}

export type ChromeApi = {
  overlayOpen: () => boolean
  planMode: () => boolean
  plusMenuOpen: () => boolean
  permissionMenuOpen: () => boolean
  permissionMode: () => PermissionMode
  permissionLabel: () => string
  settingsOpen: () => boolean
  sendShortcut: () => SendShortcut
  planPanelDismissed: () => boolean
  setPlanMode: (on: boolean) => void
  openPlusMenu: () => void
  closePlusMenu: () => void
  openPermissionMenu: () => void
  closePermissionMenu: () => void
  setPermissionMode: (mode: PermissionMode) => Promise<void>
  closePlanPanel: () => void
  openSettings: () => void
  closeSettings: () => void
  setSendShortcut: (shortcut: SendShortcut) => void
}
