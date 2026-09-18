import { describe, expect, it } from "vitest"
import { rekeyDraftSessions } from "./draft-session-state"
import { initialState } from "./state"

function draftSession(id: string, directory: string, title: string) {
  return {
    id,
    directory,
    title,
    localDraft: true as const,
    time: { created: 1, updated: 1 },
  }
}

describe("rekeyDraftSessions", () => {
  it("moves drafts to the destination path and keeps a single empty draft", () => {
    const draft = structuredClone(initialState)
    draft.drafts = {
      "session:a": { composer: "hello", attachments: [] },
      "session:b": { composer: "", attachments: [] },
      "session:c": { composer: "", attachments: [] },
    }
    draft.draftSessionsByProject = {
      "/old": [draftSession("a", "/old", "hello"), draftSession("b", "/old", "新会话")],
      "/new": [draftSession("c", "/new", "新会话")],
    }

    rekeyDraftSessions(draft, "/old", "/new")

    expect(draft.draftSessionsByProject["/old"]).toBeUndefined()
    const ids = (draft.draftSessionsByProject["/new"] ?? []).map((item) => item.id)
    expect(ids).toContain("a")
    expect(ids.filter((id) => id === "b" || id === "c")).toHaveLength(1)
    expect(ids.every((id) => (draft.draftSessionsByProject["/new"] ?? []).find((item) => item.id === id)?.directory === "/new")).toBe(true)
  })
})
