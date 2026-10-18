import fs from "node:fs"
import path from "node:path"

export function checkVersions(root: string) {
  const frontend = path.join(root, "frontend")
  const version = JSON.parse(fs.readFileSync(path.join(frontend, "package.json"), "utf8")).version
  const tauri = JSON.parse(fs.readFileSync(path.join(frontend, "src-tauri/tauri.conf.json"), "utf8")).version
  const cargo = fs
    .readFileSync(path.join(frontend, "src-tauri/Cargo.toml"), "utf8")
    .match(/^version\s*=\s*"([^"]+)"/m)?.[1]
  const lock = fs
    .readFileSync(path.join(frontend, "src-tauri/Cargo.lock"), "utf8")
    .match(/\[\[package\]\]\s+name = "coda"\s+version = "([^"]+)"/)?.[1]
  if (!/^\d+\.\d+\.\d+$/.test(version) || [tauri, cargo, lock].some((value) => value !== version))
    throw new Error(`版本号不一致：frontend=${version} tauri=${tauri} cargo=${cargo} lock=${lock}`)
  return version as string
}
if (import.meta.main) {
  try {
    console.log(`Coda ${checkVersions(path.resolve(import.meta.dir, ".."))}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
