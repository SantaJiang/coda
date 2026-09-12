import type { ComposerAttachment } from "../lib/attachments"
import type { ConfiguredModel, SelectableModel } from "../lib/models"
import type { PermissionMode } from "../lib/permissions"
import type { SendShortcut } from "../lib/settings"
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
import { loadKeepBackendAlive, loadSendShortcut } from "../lib/settings"

export type ConnectionState = "connecting" | "connected" | "disconnected"

export type QueuedMessage = {
  id: string
  text: string
  attachments: ComposerAttachment[]
  agent: string
  model: { providerID: string; modelID: string }
  variant: string | null
}

export type SessionDraft = {
  composer: string
  attachments: ComposerAttachment[]
}

export function emptySessionDraft(): SessionDraft {
  return { composer: "", attachments: [] }
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
  sessionErrors: Record<string, boolean>
  todos: Record<string, Todo[]>
  permissions: Record<string, PermissionRequest>
  questions: Record<string, QuestionRequest>
  sendingBySession: Record<string, boolean>
  drafts: Record<string, SessionDraft>
  error: string | null
  configuredModels: ConfiguredModel[]
  selectedModelKey: string | null
  discoveredModels: SelectableModel[]
  pinnedModelKeys: string[]
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
  keepBackendAlive: boolean
  selectedVariant: string | null
  modelVariants: Record<string, string[]>
  queuedBySession: Record<string, QueuedMessage[]>
  vcsBranch: string
}

export const initialState: AppState = {
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
  sessionErrors: {},
  todos: {},
  permissions: {},
  questions: {},
  sendingBySession: {},
  drafts: {},
  error: null,
  configuredModels: [],
  selectedModelKey: null,
  discoveredModels: [],
  pinnedModelKeys: [],
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
  keepBackendAlive: loadKeepBackendAlive(),
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
