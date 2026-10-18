export type TerminalInfo = {
  id: string
  sessionID: string
  rootSessionID: string
  command: string
  cwd: string
  startedAt: number
  lastOutputAt: number
  endedAt?: number
  exitCode?: number
  reason?: string
  status: "starting" | "running" | "completed" | "failed" | "cancelled" | "interrupted"
  recoverable?: boolean
  needsInput?: boolean
  nextCheckAt?: number
  consumed?: boolean
  suppressed?: boolean
  hidden?: boolean
  error?: string
  cursor: number
  baseCursor: number
}
export type TerminalLog = {
  data: string
  start: number
  cursor: number
  baseCursor: number
  endCursor: number
  truncated: boolean
  status: TerminalInfo["status"]
  ended?: boolean
}
export type TerminalAction = "cancel" | "hide" | "show" | "resume"

export function parseTerminalLog(value: unknown): TerminalLog {
  if (!value || typeof value !== "object") throw new Error("终端日志格式无效")
  const frame = value as TerminalLog
  for (const key of ["start", "cursor", "baseCursor", "endCursor"] as const) {
    if (!Number.isSafeInteger(frame[key]) || frame[key] < 0) throw new Error("终端日志游标无效")
  }
  if (
    typeof frame.data !== "string" ||
    typeof frame.truncated !== "boolean" ||
    !["starting", "running", "completed", "failed", "cancelled", "interrupted"].includes(frame.status)
  )
    throw new Error("终端日志格式无效")
  if (frame.ended !== undefined && typeof frame.ended !== "boolean") throw new Error("终端日志结束标记无效")
  if (frame.start > frame.cursor || frame.cursor > frame.endCursor || frame.baseCursor > frame.start)
    throw new Error("终端日志游标顺序无效")
  return frame
}

export function parseTerminalInfo(value: unknown): TerminalInfo {
  if (!value || typeof value !== "object") throw new Error("终端信息格式无效")
  const info = value as TerminalInfo
  for (const key of ["id", "sessionID", "rootSessionID", "command", "cwd"] as const) {
    if (typeof info[key] !== "string") throw new Error("终端信息字段无效")
  }
  for (const key of ["startedAt", "lastOutputAt", "cursor", "baseCursor"] as const) {
    if (!Number.isSafeInteger(info[key]) || info[key] < 0) throw new Error("终端信息数值无效")
  }
  if (!["starting", "running", "completed", "failed", "cancelled", "interrupted"].includes(info.status))
    throw new Error("终端状态无效")
  for (const key of ["recoverable", "needsInput", "consumed", "suppressed", "hidden"] as const) {
    if (info[key] !== undefined && typeof info[key] !== "boolean") throw new Error("终端信息标记无效")
  }
  return info
}
