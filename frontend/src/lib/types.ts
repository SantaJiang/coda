export type Project = {
  id: string
  path: string
  name: string
  expanded: boolean
  kind?: "local" | "folder"
  missing?: boolean
}

export type BackendProject = {
  id: string
  worktree: string
  vcs?: string | null
  sandboxes?: string[]
  time?: {
    created?: number
    updated?: number
  }
}

export type SessionRevertState = {
  messageID: string
  partID?: string
}

export type Session = {
  id: string
  slug?: string
  projectID?: string
  directory: string
  parentID?: string
  title: string
  agent?: string
  model?: {
    id: string
    providerID: string
    variant?: string
  }
  time: {
    created: number
    updated: number
    archived?: number
  }
  revert?: SessionRevertState | null
}

export type SessionStatus =
  | { type: "idle" }
  | { type: "busy" }
  | { type: "retry"; attempt?: number; message?: string; next?: number }

export type UserMessage = {
  id: string
  sessionID: string
  role: "user"
  time: { created: number }
  agent?: string
  model?: {
    providerID: string
    modelID: string
    variant?: string
  }
}

export type AssistantError = {
  name?: string
  data?: {
    message?: string
    providerID?: string
  }
}

export type AssistantMessage = {
  id: string
  sessionID: string
  role: "assistant"
  time: { created: number; completed?: number }
  error?: AssistantError
  parentID?: string
  modelID?: string
  providerID?: string
  agent?: string
  mode?: string
  summary?: boolean
  cost?: number
}

export type Message = UserMessage | AssistantMessage

export type TextPart = {
  id: string
  sessionID: string
  messageID: string
  type: "text"
  text: string
  synthetic?: boolean
  ignored?: boolean
}

export type ReasoningPart = {
  id: string
  sessionID: string
  messageID: string
  type: "reasoning"
  text: string
}

export type FilePart = {
  id: string
  sessionID: string
  messageID: string
  type: "file"
  mime?: string
  filename?: string
  url?: string
}

export type AgentPart = {
  id: string
  sessionID: string
  messageID: string
  type: "agent"
  name: string
}

export type ToolState =
  | { status: "pending"; input?: Record<string, unknown>; raw?: string }
  | {
      status: "running"
      input?: Record<string, unknown>
      title?: string
      metadata?: Record<string, unknown>
      time?: { start?: number }
    }
  | {
      status: "completed"
      input?: Record<string, unknown>
      output?: string
      title?: string
      metadata?: Record<string, unknown>
      time?: { start?: number; end?: number }
    }
  | {
      status: "error"
      input?: Record<string, unknown>
      error?: string
      metadata?: Record<string, unknown>
      time?: { start?: number; end?: number }
    }

export type ToolPart = {
  id: string
  sessionID: string
  messageID: string
  type: "tool"
  callID: string
  tool: string
  state: ToolState
}

export type RetryPart = {
  id: string
  sessionID: string
  messageID: string
  type: "retry"
  attempt: number
  error?: { data?: { message?: string } }
}

export type CompactionPart = {
  id: string
  sessionID: string
  messageID: string
  type: "compaction"
}

export type MetaPart = {
  id: string
  sessionID: string
  messageID: string
  type: "step-start" | "step-finish" | "patch" | "snapshot"
}

export type Part = TextPart | ReasoningPart | FilePart | AgentPart | ToolPart | RetryPart | CompactionPart | MetaPart

export type MessageWithParts = {
  info: Message
  parts: Part[]
}

export type Todo = {
  content: string
  status: string
  priority?: string
}

export type PermissionRequest = {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  metadata?: Record<string, unknown>
  always?: string[]
}

export type QuestionOption = {
  label: string
  description?: string
}

export type QuestionInfo = {
  question: string
  header?: string
  options: QuestionOption[]
  multiple?: boolean
  custom?: boolean
}

export type QuestionRequest = {
  id: string
  sessionID: string
  questions: QuestionInfo[]
}

export type EventEnvelope = {
  id?: string
  type: string
  properties?: Record<string, unknown>
  data?: Record<string, unknown>
}

export type GlobalEvent = {
  directory?: string
  project?: string
  payload?: EventEnvelope
} & Partial<EventEnvelope>
