import { describe, expect, it } from "vitest"
import { STORAGE_KEYS } from "./config"
import {
  filterProjectSessions,
  hydrateDraftSessions,
  loadDraftSessions,
  restoreCandidates,
  saveDraftSessions,
  serializeDraftSessions,
} from "./persist"
import type { BackendProject, Project, Session } from "./types"

function project(path: string, extra: Partial<Project> = {}): Project {
  return { id: `prj_${path}`, path, name: path, expanded: true, ...extra }
}

function backend(id: string, worktree: string, extra: Partial<BackendProject> = {}): BackendProject {
  return { id, worktree, ...extra }
}

function session(id: string, directory: string, projectID?: string): Session {
  return {
    id,
    directory,
    title: id,
    time: { created: 1, updated: 1 },
    ...(projectID ? { projectID } : {}),
  }
}

describe("restoreCandidates", () => {
  it("returns worktree-first candidate dirs and skips the global entry", () => {
    const groups = restoreCandidates(
      [project("/Users/santa")],
      [backend("global", "/"), backend("p1", "/Users/santa/Work/app", { sandboxes: ["/tmp/app"] })],
    )
    expect(groups).toEqual([["/Users/santa/Work/app", "/tmp/app"]])
  })

  it("skips backend projects already covered by an existing project path", () => {
    const groups = restoreCandidates(
      [project("/tmp/app"), project("/Users/santa/Work/other")],
      [
        backend("p1", "/Users/santa/Work/app", { sandboxes: ["/tmp/app"] }),
        backend("p2", "/Users/santa/Work/other"),
        backend("p3", "/Users/santa/Work/new"),
      ],
    )
    expect(groups).toEqual([["/Users/santa/Work/new"]])
  })

  it("orders groups by most recently updated and dedupes dirs", () => {
    const groups = restoreCandidates(
      [],
      [
        backend("p1", "/tmp/old", { time: { created: 1, updated: 10 } }),
        backend("p2", "/tmp/new", { sandboxes: ["/tmp/new"], time: { created: 1, updated: 99 } }),
        backend("p3", "/tmp/mid", { time: { created: 1, updated: 50 } }),
      ],
    )
    expect(groups).toEqual([["/tmp/new"], ["/tmp/mid"], ["/tmp/old"]])
  })

  it("matches windows paths case-insensitively", () => {
    const groups = restoreCandidates(
      [project("C:\\Users\\me\\App")],
      [backend("p1", "c:/users/me/app"), backend("p2", "C:\\Users\\me\\Other")],
    )
    expect(groups).toEqual([["C:\\Users\\me\\Other"]])
  })

  it("does not restore the same directory through two backend projects", () => {
    const groups = restoreCandidates(
      [],
      [
        backend("p1", "/tmp/a", { sandboxes: ["/tmp/shared"], time: { created: 1, updated: 2 } }),
        backend("p2", "/tmp/shared", { time: { created: 1, updated: 1 } }),
      ],
    )
    expect(groups).toEqual([["/tmp/a", "/tmp/shared"]])
  })
})

describe("filterProjectSessions", () => {
  it("drops global-project sessions from other directories", () => {
    const kept = filterProjectSessions(
      [
        session("own", "/Volumes/Movie/AV/JK0571", "global"),
        session("own-child", "/Volumes/Movie/AV/JK0571/sub", "global"),
        session("leaked", "/Users/santa/Movies/other", "global"),
        session("leaked-home", "/Users/santa", "global"),
      ],
      "/Volumes/Movie/AV/JK0571",
    )
    expect(kept.map((item) => item.id)).toEqual(["own", "own-child"])
  })

  it("keeps sessions of a real backend project regardless of directory", () => {
    const kept = filterProjectSessions(
      [session("worktree", "/tmp/sandbox/app", "abc123"), session("mine", "/Users/me/app", "abc123")],
      "/Users/me/app",
    )
    expect(kept.map((item) => item.id)).toEqual(["worktree", "mine"])
  })

  it("treats sessions without projectID by directory", () => {
    const kept = filterProjectSessions(
      [session("inside", "/Users/me/app/x"), session("outside", "/Users/me/other")],
      "/Users/me/app",
    )
    expect(kept.map((item) => item.id)).toEqual(["inside"])
  })
})

describe("draft session persistence", () => {
  it("omits empty drafts from serialized storage", () => {
    const stored = serializeDraftSessions(
      {
        "/tmp/app": [
          {
            id: "draft_empty",
            directory: "/tmp/app",
            title: "新会话",
            localDraft: true,
            time: { created: 1, updated: 1 },
          },
          {
            id: "draft_kept",
            directory: "/tmp/app",
            title: "hello",
            localDraft: true,
            time: { created: 2, updated: 3 },
          },
        ],
      },
      {
        "session:draft_empty": { composer: "  ", attachments: [] },
        "session:draft_kept": {
          composer: "hello",
          attachments: [{ id: "a1", filename: "a.ts", mime: "text/plain", kind: "file", url: "file:///a.ts", label: "TS" }],
        },
      },
      { draft_kept: true },
    )
    expect(stored["/tmp/app"]?.map((item) => item.id)).toEqual(["draft_kept"])
    expect(stored["/tmp/app"]?.[0]).toMatchObject({
      composer: "hello",
      planMode: true,
    })
  })

  it("round-trips non-empty drafts and drops empties on load", () => {
    localStorage.removeItem(STORAGE_KEYS.draftSessions)
    saveDraftSessions(
      {
        "/tmp/app": [
          {
            id: "draft_kept",
            directory: "/tmp/app",
            title: "新会话",
            localDraft: true,
            time: { created: 8, updated: 9 },
          },
        ],
      },
      { "session:draft_kept": { composer: "保存我", attachments: [] } },
      {},
    )
    const loaded = loadDraftSessions()
    expect(loaded.draftSessionsByProject["/tmp/app"]?.[0]).toMatchObject({
      id: "draft_kept",
      title: "保存我",
      localDraft: true,
    })
    expect(loaded.drafts["session:draft_kept"]?.composer).toBe("保存我")

    const hydrated = hydrateDraftSessions({
      "/tmp/app": [
        {
          id: "draft_empty",
          directory: "/tmp/app",
          time: { created: 1, updated: 1 },
          composer: "",
          attachments: [],
        },
      ],
    })
    expect(hydrated.draftSessionsByProject["/tmp/app"]).toBeUndefined()
    localStorage.removeItem(STORAGE_KEYS.draftSessions)
  })
})
