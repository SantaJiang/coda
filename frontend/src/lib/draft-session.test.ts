import { describe, expect, it } from "vitest"
import {
  createLocalDraftSession,
  draftSidebarTitle,
  extraEmptyDraftIds,
  findEmptyDraft,
  isEmptyDraftContent,
  isLocalDraft,
  mergeSessionLists,
  newestDraft,
} from "./draft-session"
import type { Session } from "./types"

function draft(id: string, updated: number, directory = "/tmp/app"): Session {
  return {
    id,
    directory,
    title: id,
    localDraft: true,
    time: { created: updated, updated },
  }
}

describe("draft session helpers", () => {
  it("treats whitespace-only composer without attachments as empty", () => {
    expect(isEmptyDraftContent("", [])).toBe(true)
    expect(isEmptyDraftContent("   \n", [])).toBe(true)
    expect(isEmptyDraftContent("hello", [])).toBe(false)
    expect(isEmptyDraftContent("", [{ id: "a" }])).toBe(false)
  })

  it("uses the first non-empty line as the sidebar title", () => {
    expect(draftSidebarTitle("")).toBe("新会话")
    expect(draftSidebarTitle("  \n  ")).toBe("新会话")
    expect(draftSidebarTitle("  修一下标题  \n第二行")).toBe("修一下标题")
    expect(draftSidebarTitle("hello   world")).toBe("hello world")
  })

  it("finds the empty draft and reports extras to drop", () => {
    const sessions = [draft("d1", 1), draft("d2", 2), draft("d3", 3)]
    const bundles = {
      "session:d1": { composer: "kept", attachments: [] },
      "session:d2": { composer: "", attachments: [] },
      "session:d3": { composer: "  ", attachments: [] },
    }
    expect(findEmptyDraft(sessions, bundles)?.id).toBe("d2")
    expect(extraEmptyDraftIds(sessions, bundles, "d2")).toEqual(["d3"])
    expect(extraEmptyDraftIds(sessions, bundles, "d3")).toEqual(["d2"])
  })

  it("sorts merged lists by updated time and picks the newest draft", () => {
    const drafts = [draft("d1", 10), draft("d2", 40)]
    const history: Session[] = [
      { id: "s1", directory: "/tmp/app", title: "old", time: { created: 1, updated: 20 } },
    ]
    expect(mergeSessionLists(drafts, history).map((item) => item.id)).toEqual(["d2", "s1", "d1"])
    expect(newestDraft(drafts)?.id).toBe("d2")
  })

  it("marks locally created sessions as drafts", () => {
    const session = createLocalDraftSession("/tmp/app", 1, "draft_fixed")
    expect(session).toMatchObject({
      id: "draft_fixed",
      directory: "/tmp/app",
      title: "新会话",
      localDraft: true,
    })
    expect(isLocalDraft(session)).toBe(true)
    expect(isLocalDraft({ id: "s1", directory: "/tmp", title: "x", time: { created: 1, updated: 1 } })).toBe(false)
  })
})
