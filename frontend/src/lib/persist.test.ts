import { describe, expect, it } from "vitest"
import { restoreCandidates } from "./persist"
import type { BackendProject, Project } from "./types"

function project(path: string, extra: Partial<Project> = {}): Project {
  return { id: `prj_${path}`, path, name: path, expanded: true, ...extra }
}

function backend(id: string, worktree: string, extra: Partial<BackendProject> = {}): BackendProject {
  return { id, worktree, ...extra }
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
