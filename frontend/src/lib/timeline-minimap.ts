import type { ConversationTurn, TurnPhase } from "./conversation"

/**
 * A conversation has no heading hierarchy, so the minimap encodes turns
 * instead: one mark per turn, folded into a group once the session gets long.
 */
export const MINIMAP_LIMIT = 32

export type MinimapMark = {
  /** Turn id the mark jumps to. */
  id: string
  /** Every turn id folded into this mark. */
  ids: string[]
  /** Turns folded into this mark. */
  count: number
  /** 0..1 length driver, relative to the largest mark. */
  weight: number
  /** Short status of the most relevant turn in the group. */
  label: string
  /** Prompt of the first turn in the group that has one. */
  question: string
  active: boolean
  failed: boolean
}

const PHASE_TEXT: Record<TurnPhase, string> = {
  sending: "发送中",
  waiting: "等待回复",
  running: "进行中",
  permission: "待授权",
  question: "待回答",
  retry: "重试中",
  stopping: "停止中",
  settling: "收尾中",
  done: "已完成",
  failed: "失败",
  stopped: "已停止",
  interrupted: "已中断",
}

/** Which phase should represent a folded group. */
function rank(phase: TurnPhase) {
  if (phase === "permission" || phase === "question") return 5
  if (["running", "retry", "stopping", "settling", "waiting", "sending"].includes(phase)) return 4
  if (phase === "failed") return 3
  if (phase === "interrupted") return 2
  if (phase === "stopped") return 1
  return 0
}

/**
 * Fold turns into at most `limit` marks. Long sessions merge neighbouring turns
 * so the rail never grows taller than the viewport; the merged mark keeps the
 * first turn as its jump target and the most relevant phase as its status.
 */
export function minimapMarks(
  turns: readonly ConversationTurn[],
  questionOf: (turn: ConversationTurn) => string,
  limit = MINIMAP_LIMIT,
): MinimapMark[] {
  if (!turns.length) return []
  const chunk = turns.length <= limit ? 1 : Math.ceil(turns.length / limit)
  const marks: MinimapMark[] = []
  for (let start = 0; start < turns.length; start += chunk) {
    const group = turns.slice(start, start + chunk)
    let weight = 0
    let lead = group[0]!
    for (const turn of group) {
      weight += Math.max(1, turn.entries.length)
      if (rank(turn.phase) > rank(lead.phase)) lead = turn
    }
    marks.push({
      id: group[0]!.id,
      ids: group.map((turn) => turn.id),
      count: group.length,
      weight,
      label: PHASE_TEXT[lead.phase],
      question: group.map(questionOf).find((text) => text.trim())?.trim() ?? "",
      active: group.some((turn) => turn.active),
      failed: group.some((turn) => turn.phase === "failed"),
    })
  }
  const max = Math.max(...marks.map((mark) => mark.weight))
  return marks.map((mark) => ({ ...mark, weight: max > 0 ? mark.weight / max : 0 }))
}

/** Index of the mark currently holding `turnID`, or -1. */
export function markIndexOf(marks: readonly MinimapMark[], turnID: string | undefined) {
  if (!turnID) return -1
  return marks.findIndex((mark) => mark.ids.includes(turnID))
}
