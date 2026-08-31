import { STORAGE_KEYS } from "./config"

export type PermissionAction = "allow" | "ask" | "deny"

export type PermissionRule = {
  permission: string
  pattern: string
  action: PermissionAction
}

export type PermissionMode = "default" | "ask" | "readonly" | "allow"

export type PermissionPreset = {
  id: PermissionMode
  label: string
  description: string
}

export const PERMISSION_PRESETS: PermissionPreset[] = [
  {
    id: "default",
    label: "默认",
    description: "项目内操作自动允许，危险操作会询问",
  },
  {
    id: "ask",
    label: "询问",
    description: "每次工具调用都要确认",
  },
  {
    id: "readonly",
    label: "只读",
    description: "只能读和搜索，不能改文件或跑命令",
  },
  {
    id: "allow",
    label: "全允许",
    description: "所有操作自动放行，包括项目外路径",
  },
]

const MODES = new Set<PermissionMode>(PERMISSION_PRESETS.map((item) => item.id))

function rule(permission: string, action: PermissionAction, pattern = "*"): PermissionRule {
  return { permission, pattern, action }
}

export function permissionRuleset(mode: PermissionMode): PermissionRule[] {
  if (mode === "ask") return [rule("*", "ask")]
  if (mode === "allow") {
    return [rule("*", "allow"), rule("doom_loop", "allow"), rule("external_directory", "allow")]
  }
  if (mode === "readonly") {
    return [
      rule("*", "deny"),
      rule("read", "allow"),
      rule("grep", "allow"),
      rule("glob", "allow"),
      rule("list", "allow"),
      rule("websearch", "allow"),
      rule("todowrite", "allow"),
      rule("webfetch", "ask"),
    ]
  }
  return [
    rule("*", "allow"),
    rule("doom_loop", "ask"),
    rule("external_directory", "ask"),
    rule("read", "allow"),
    rule("read", "ask", "*.env"),
    rule("read", "ask", "*.env.*"),
    rule("read", "allow", "*.env.example"),
  ]
}

export function permissionPreset(mode: PermissionMode) {
  return PERMISSION_PRESETS.find((item) => item.id === mode) ?? PERMISSION_PRESETS[0]
}

const READONLY_ALLOW = new Set(["read", "grep", "glob", "list", "websearch", "todowrite", "todo"])

export function autoReplyForMode(
  mode: PermissionMode,
  permission: string,
): "once" | "always" | "reject" | null {
  if (mode === "allow") return "always"
  if (mode === "readonly") return READONLY_ALLOW.has(permission) ? "always" : "reject"
  return null
}

export function loadPermissionMode(): PermissionMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.permissionMode)
    if (raw && MODES.has(raw as PermissionMode)) return raw as PermissionMode
  } catch {
    // ignore
  }
  return "default"
}

export function savePermissionMode(mode: PermissionMode) {
  localStorage.setItem(STORAGE_KEYS.permissionMode, mode)
}
