import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { checkVersions } from "./check-versions"

test("checks the package's own lockfile entry, rather than the first dependency", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coda-version-test-"))
  const frontend = path.join(root, "frontend"),
    tauri = path.join(frontend, "src-tauri")
  fs.mkdirSync(tauri, { recursive: true })
  try {
    for (const file of [path.join(frontend, "package.json"), path.join(tauri, "tauri.conf.json")])
      fs.writeFileSync(file, JSON.stringify({ version: "1.5.2" }))
    fs.writeFileSync(path.join(tauri, "Cargo.toml"), '[package]\nname = "coda"\nversion = "1.5.2"\n')
    const lock = path.join(tauri, "Cargo.lock")
    fs.writeFileSync(
      lock,
      '[[package]]\nname = "dependency"\nversion = "9.0.0"\n\n[[package]]\nname = "coda"\nversion = "1.5.2"\n',
    )
    expect(checkVersions(root)).toBe("1.5.2")
    fs.writeFileSync(lock, fs.readFileSync(lock, "utf8").replace('version = "1.5.2"', 'version = "1.5.1"'))
    expect(() => checkVersions(root)).toThrow("lock=1.5.1")
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
