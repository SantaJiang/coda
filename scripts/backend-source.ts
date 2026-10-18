import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

type Input = { backend: string; base: string; revision?: string; patches: string[]; apply?: boolean }
const git = (cwd: string, args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()

/** Only materialize a recorded patch series over a known, otherwise clean source tree. */
export function prepareBackend(input: Input) {
  if (git(input.backend, ["rev-parse", "HEAD"]) !== (input.revision ?? input.base))
    throw new Error("后端基线与补丁清单不一致，请先更新并验证补丁清单")
  const targets = new Set<string>()
  for (const patch of input.patches) {
    for (const line of fs.readFileSync(patch, "utf8").split("\n")) {
      if (!line.startsWith("+++ b/") && !line.startsWith("--- a/")) continue
      const target = line.slice(6)
      if (target.startsWith("/") || target.includes("\\") || target.split("/").includes(".."))
        throw new Error("补丁路径无效")
      targets.add(target)
    }
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "coda-backend-source-"))
  try {
    for (const target of targets) {
      const result = spawnSync("git", ["show", `${input.base}:${target}`], {
        cwd: input.backend,
        maxBuffer: 16 * 1024 * 1024,
      })
      if (result.status !== 0) continue // Added files do not exist at the pinned base.
      const dest = path.join(scratch, target)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, result.stdout)
    }
    for (const patch of input.patches) git(scratch, ["apply", "--whitespace=error", patch])
    const changed = git(input.backend, ["diff", "--name-only", "HEAD"]).split("\n").filter(Boolean)
    const added = git(input.backend, ["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean)
    const unknown = [...changed, ...added].filter((name) => !targets.has(name))
    if (unknown.length) throw new Error(`后端含有未登记修改，未覆盖：${unknown.join(", ")}`)
    const matches = () =>
      [...targets].every((target) => {
        const actual = path.join(input.backend, target),
          expected = path.join(scratch, target)
        return fs.existsSync(expected)
          ? fs.existsSync(actual) && fs.readFileSync(actual).equals(fs.readFileSync(expected))
          : !fs.existsSync(actual)
      })
    if (matches()) return
    if (!input.apply || changed.length || added.length || (input.revision ?? input.base) !== input.base)
      throw new Error("后端源码不匹配登记的补丁系列；仅可向干净基线应用补丁，现有修改未覆盖")
    for (const patch of input.patches) git(input.backend, ["apply", "--whitespace=error", patch])
    if (!matches()) throw new Error("后端补丁应用后校验失败")
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  try {
    const root = path.resolve(import.meta.dir, "..")
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "patches/backend/manifest.json"), "utf8")) as {
      base: string
      revision?: string
      patches: string[]
    }
    // Validate the checked-out revision directly so a new gitlink can be tested before
    // committing the parent. A clean CI checkout obtains this revision from its gitlink.
    prepareBackend({
      backend: path.join(root, "backend"),
      base: manifest.base,
      revision: manifest.revision,
      patches: manifest.patches.map((name) => path.join(root, "patches/backend", name)),
      apply: process.argv.includes("--apply"),
    })
    console.log("Coda 后端源码与登记补丁一致")
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
