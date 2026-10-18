import type { ComposerAttachment } from "../lib/attachments"
import type { ConfiguredModel, SelectableModel } from "../lib/models"
import type { PermissionMode } from "../lib/permissions"
import type { SendShortcut, TaskRecovery, StopBehavior, CloseBehavior } from "../lib/settings"
import type { TimelineViewState } from "../lib/conversation"
import type {
  Message,
  Part,
  PermissionRequest,
  Project,
  QuestionRequest,
  Session,
  SessionStatus,
  Todo,
} from "../lib/types"
import { loadPermissionMode } from "../lib/permissions"
import { loadCloseBehavior, loadTaskRecovery, loadStopBehavior, loadSendShortcut } from "../lib/settings"

export type ConnectionState = "connecting" | "connected" | "disconnected"

export type QueuedMessage = {
  id: string
  text: string
  attachments: ComposerAttachment[]
  agent: string
  model: { providerID: string; modelID: string }
  variant: string | null
  directory: string
}

export type SessionDraft = {
  composer: string
  attachments: ComposerAttachment[]
}

export type OutgoingPrompt = {
  messageID: string
  sessionID: string
  project: Project
  text: string
  files: ComposerAttachment[]
  model: { providerID: string; modelID: string }
  agent: string
  variant?: string | null
  partIDs: string[]
}

export function emptySessionDraft(): SessionDraft {
  return { composer: "", attachments: [] }
}

export type AppState = {
  connection: ConnectionState
  projects: Project[]
  sessionsByProject: Record<string, Session[]>
  draftSessionsByProject: Record<string, Session[]>
  selectedProjectId: string | null
  selectedSessionId: string | null
  draft: boolean
  messages: Record<string, Message[]>
  parts: Record<string, Part[]>
  status: Record<string, SessionStatus>
  attention: Record<string, boolean>
  sessionErrors: Record<string, boolean>
  sessionErrorText: Record<string, string>
  todos: Record<string, Todo[]>
  permissions: Record<string, PermissionRequest>
  questions: Record<string, QuestionRequest>
  sendingBySession: Record<string, boolean>
  stoppingBySession: Record<string, boolean>
  stoppedTurnBySession: Record<string, string>
  stoppedTurns: Record<string, boolean>
  syncErrors: Record<string, string>
  settlingBySession: Record<string, boolean>
  eventRevision: Record<string, number>
  seenEventIDs: string[]
  removedMessages: Record<string, string>
  removedParts: Record<string, { messageID: string; sessionID: string }>
  outgoing: Record<string, OutgoingPrompt>
  timelineViews: Record<string, TimelineViewState>
  drafts: Record<string, SessionDraft>
  error: string | null
  configuredModels: ConfiguredModel[]
  selectedModelKey: string | null
  discoveredModels: SelectableModel[]
  modelMenuOpen: boolean
  modelSettingsOpen: boolean
  modelSettingsError: string | null
  planModeBySession: Record<string, boolean>
  draftPlanMode: boolean
  plusMenuOpen: boolean
  variantMenuOpen: boolean
  permissionMenuOpen: boolean
  permissionMode: PermissionMode
  planPanelDismissed: boolean
  settingsOpen: boolean
  sendShortcut: SendShortcut
  taskRecovery: TaskRecovery
  stopBehavior: StopBehavior
  closeBehavior: CloseBehavior
  selectedVariant: string | null
  modelVariants: Record<string, string[]>
  queuedBySession: Record<string, QueuedMessage[]>
  vcsBranch: string
}

export const initialState: AppState = {
  connection: "connecting",
  projects: [],
  sessionsByProject: {},
  draftSessionsByProject: {},
  selectedProjectId: null,
  selectedSessionId: null,
  draft: true,
  messages: {},
  parts: {},
  status: {},
  attention: {},
  sessionErrors: {},
  sessionErrorText: {},
  todos: {},
  permissions: {},
  questions: {},
  sendingBySession: {},
  stoppingBySession: {},
  stoppedTurnBySession: {},
  stoppedTurns: {},
  syncErrors: {},
  settlingBySession: {},
  eventRevision: {},
  seenEventIDs: [],
  removedMessages: {},
  removedParts: {},
  outgoing: {},
  timelineViews: {},
  drafts: {},
  error: null,
  configuredModels: [],
  selectedModelKey: null,
  discoveredModels: [],
  modelMenuOpen: false,
  modelSettingsOpen: false,
  modelSettingsError: null,
  planModeBySession: {},
  draftPlanMode: false,
  plusMenuOpen: false,
  variantMenuOpen: false,
  permissionMenuOpen: false,
  permissionMode: loadPermissionMode(),
  planPanelDismissed: false,
  settingsOpen: false,
  sendShortcut: loadSendShortcut(),
  taskRecovery: loadTaskRecovery(),
  stopBehavior: loadStopBehavior(),
  closeBehavior: loadCloseBehavior(),
  selectedVariant: null,
  modelVariants: {},
  queuedBySession: {},
  vcsBranch: "",
}

export type PopoverName = "model" | "plus" | "variant" | "permission"

export function popoverPatch(open: PopoverName | null) {
  return {
    modelMenuOpen: open === "model",
    plusMenuOpen: open === "plus",
    variantMenuOpen: open === "variant",
    permissionMenuOpen: open === "permission",
  }
}
