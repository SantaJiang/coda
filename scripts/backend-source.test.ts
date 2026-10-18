import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { prepareBackend } from "./backend-source"

test("clean checkouts materialize the registered series; unknown edits are preserved", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coda-source-test-"))
  const backend = path.join(root, "backend")
  fs.mkdirSync(backend)
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: backend, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
  try {
    git("init", "--quiet")
    fs.writeFileSync(path.join(backend, "fixture.ts"), "export const value = 1\n")
    git("add", ".")
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    )
    const base = git("rev-parse", "HEAD")
    fs.writeFileSync(path.join(backend, "fixture.ts"), "export const value = 2\n")
    const patch = path.join(root, "fixture.patch")
    fs.writeFileSync(patch, git("diff") + "\n")
    git("restore", "fixture.ts")
    const input = { backend, base, patches: [patch] }
    expect(() => prepareBackend(input)).toThrow()
    prepareBackend({ ...input, apply: true })
    prepareBackend(input)
    expect(fs.readFileSync(path.join(backend, "fixture.ts"), "utf8")).toContain("value = 2")
    fs.writeFileSync(path.join(backend, "fixture.ts"), "local edit\n")
    expect(() => prepareBackend({ ...input, apply: true })).toThrow()
    expect(fs.readFileSync(path.join(backend, "fixture.ts"), "utf8")).toBe("local edit\n")
    fs.writeFileSync(path.join(backend, "extra.ts"), "unregistered\n")
    expect(() => prepareBackend({ ...input, apply: true })).toThrow("未登记修改")
    expect(() => prepareBackend({ ...input, base: "0000000000000000000000000000000000000000" })).toThrow("基线")
    fs.rmSync(path.join(backend, "extra.ts"))
    fs.writeFileSync(path.join(backend, "fixture.ts"), "export const value = 2\n")
    git("add", ".")
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "-m",
      "record patched source",
    )
    const revision = git("rev-parse", "HEAD")
    expect(() => prepareBackend(input)).toThrow("基线")
    prepareBackend({ ...input, revision })
    expect(fs.readFileSync(path.join(backend, "fixture.ts"), "utf8")).toContain("value = 2")
    fs.writeFileSync(path.join(backend, "fixture.ts"), "unexpected committed content\n")
    git("add", ".")
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "-m",
      "mismatched source",
    )
    expect(() => prepareBackend({ ...input, revision })).toThrow("基线")
    expect(() => prepareBackend({ ...input, revision: git("rev-parse", "HEAD") })).toThrow("不匹配")
    expect(() => prepareBackend({ ...input, revision: git("rev-parse", "HEAD"), apply: true })).toThrow("不匹配")
    expect(fs.readFileSync(path.join(backend, "fixture.ts"), "utf8")).toBe("unexpected committed content\n")
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
