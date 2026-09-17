#!/usr/bin/env bash
# Decide whether this commit should trigger GitHub packaging.
# Pack when major or minor (中版本) changes, e.g. 1.0.0 -> 1.1.0 or 2.0.0.
# Skip patch-only bumps, e.g. 1.0.0 -> 1.0.1.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAURI_CONF="$ROOT/frontend/src-tauri/tauri.conf.json"
PACKAGE_JSON="$ROOT/frontend/package.json"
CARGO_TOML="$ROOT/frontend/src-tauri/Cargo.toml"
VERSION_PATH="frontend/src-tauri/tauri.conf.json"

read_json_version() {
  sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)".*/\1/p' "$1" | head -n 1
}

read_cargo_version() {
  sed -n 's/^version[[:space:]]*=[[:space:]]*"\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)".*/\1/p' "$1" | head -n 1
}

read_version_from_text() {
  printf '%s\n' "$1" | sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)".*/\1/p' | head -n 1
}

major_minor() {
  printf '%s\n' "$1" | awk -F. '{print $1 "." $2}'
}

write_output() {
  local current="$1"
  local previous="$2"
  local should_pack="$3"
  local reason="$4"
  echo "version=$current"
  echo "previous=${previous:-}"
  echo "should_pack=$should_pack"
  echo "reason=$reason"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    {
      echo "version=$current"
      echo "previous=${previous:-}"
      echo "should_pack=$should_pack"
      echo "reason=$reason"
    } >> "$GITHUB_OUTPUT"
  fi
}

current="$(read_json_version "$TAURI_CONF")"
if [[ -z "$current" ]]; then
  echo "无法读取当前版本：$TAURI_CONF" >&2
  exit 1
fi

pkg_ver="$(read_json_version "$PACKAGE_JSON")"
cargo_ver="$(read_cargo_version "$CARGO_TOML")"
if [[ "$pkg_ver" != "$current" || "$cargo_ver" != "$current" ]]; then
  echo "版本号不一致：tauri.conf.json=$current frontend/package.json=$pkg_ver Cargo.toml=$cargo_ver" >&2
  echo "发布前必须把这三处改成同一个 x.y.z。" >&2
  exit 1
fi

prev=""
if git -C "$ROOT" rev-parse --verify HEAD^ >/dev/null 2>&1; then
  prev="$(read_version_from_text "$(git -C "$ROOT" show "HEAD^:$VERSION_PATH" 2>/dev/null || true)")"
fi

if [[ "${FORCE_PACK:-}" == "true" || "${FORCE_PACK:-}" == "1" ]]; then
  write_output "$current" "$prev" "true" "手动强制打包 $current"
  exit 0
fi

if [[ -z "$prev" ]]; then
  write_output "$current" "$prev" "true" "找不到上一版本，按当前 $current 打包"
  exit 0
fi

if [[ "$(major_minor "$current")" != "$(major_minor "$prev")" ]]; then
  write_output "$current" "$prev" "true" "中版本变化 $prev -> $current"
  exit 0
fi

write_output "$current" "$prev" "false" "仅补丁号或版本未变 $prev -> $current，跳过打包"
