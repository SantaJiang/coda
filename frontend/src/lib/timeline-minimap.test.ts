import { describe, expect, it } from "vitest"
import type { ConversationEntry, ConversationTurn } from "./conversation"
import { MINIMAP_LIMIT, markIndexOf, minimapMarks } from "./timeline-minimap"

function turn(id: string, entries: number, phase: ConversationTurn["phase"] = "done", active = false): ConversationTurn {
  return {
    id,
    assistants: [],
    entries: new Array(entries).fill(null) as ConversationEntry[],
    process: [],
    answer: [],
    phase,
    active,
    label: {} as ConversationTurn["label"],
    summary: "",
    durationMs: 0,
    failures: 0,
  }
}

const noQuestion = () => ""

describe("minimapMarks", () => {
  it("returns one mark per turn while the session is short", () => {
    const marks = minimapMarks([turn("a", 2), turn("b", 5)], noQuestion)
    expect(marks.map((mark) => mark.id)).toEqual(["a", "b"])
    expect(marks.map((mark) => mark.count)).toEqual([1, 1])
  })

  it("normalises length against the largest turn", () => {
    const marks = minimapMarks([turn("a", 1), turn("b", 4)], noQuestion)
    expect(marks[1]!.weight).toBe(1)
    expect(marks[0]!.weight).toBeCloseTo(0.25)
  })

  it("folds long sessions so the rail cannot outgrow the viewport", () => {
    const turns = Array.from({ length: MINIMAP_LIMIT * 4 }, (_, index) => turn(`t${index}`, 1))
    const marks = minimapMarks(turns, noQuestion)
    expect(marks.length).toBeLessThanOrEqual(MINIMAP_LIMIT)
    expect(marks.reduce((total, mark) => total + mark.count, 0)).toBe(turns.length)
    expect(marks.flatMap((mark) => mark.ids)).toEqual(turns.map((item) => item.id))
  })

  it("jumps a folded mark to its first turn", () => {
    const turns = Array.from({ length: MINIMAP_LIMIT * 2 }, (_, index) => turn(`t${index}`, 1))
    const marks = minimapMarks(turns, noQuestion)
    expect(marks[0]!.id).toBe(turns[0]!.id)
  })

  it("labels a folded group with its most relevant phase", () => {
    // Two full rails of turns force chunking, so the first mark folds t0 and t1.
    const long = () => Array.from({ length: MINIMAP_LIMIT * 2 }, (_, index) => turn(`t${index}`, 1))
    const failed = long()
    failed[1] = turn("t1", 1, "failed")
    const marks = minimapMarks(failed, noQuestion)
    expect(marks[0]!.count).toBe(2)
    expect(marks[0]!.label).toBe("失败")
    expect(marks[0]!.failed).toBe(true)

    const pending = long()
    pending[1] = turn("t1", 1, "running", true)
    const live = minimapMarks(pending, noQuestion)
    expect(live[0]!.label).toBe("进行中")
    expect(live[0]!.active).toBe(true)
  })

  it("keeps the first prompt of a group", () => {
    const marks = minimapMarks([turn("a", 1), turn("b", 1), turn("c", 1)], (item) => (item.id === "b" ? "  改写时间线  " : ""))
    expect(marks[1]!.question).toBe("改写时间线")
    expect(marks[0]!.question).toBe("")
  })

  it("has no marks without turns", () => {
    expect(minimapMarks([], noQuestion)).toEqual([])
  })
})

describe("markIndexOf", () => {
  it("finds the folded mark holding a turn", () => {
    const marks = minimapMarks([turn("a", 1, "done")], noQuestion)
    expect(markIndexOf(marks, "a")).toBe(0)
    expect(markIndexOf(marks, "missing")).toBe(-1)
    expect(markIndexOf(marks, undefined)).toBe(-1)
  })
})
