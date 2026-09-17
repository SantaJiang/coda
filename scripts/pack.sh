#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND="$ROOT/frontend"
cd "$ROOT"

usage() {
  cat <<'EOF'
用法: ./scripts/pack.sh [--bundles <targets>]

每次都会重新编译内置后端、前端与 Rust，并按当前系统打包成可独立运行的安装包：
  macOS  -> dmg
  Windows -> nsis（生成 setup.exe）
  Linux  -> deb 与 rpm

GitHub Actions 只打三个目标：Windows nsis、macOS Apple Silicon dmg、Linux deb。
可用 --bundles 或环境变量 PACK_BUNDLES 覆盖，例如：
  ./scripts/pack.sh --bundles deb
  PACK_BUNDLES=dmg ./scripts/pack.sh

本脚本不跑自动化测试；本地请先执行 bun run test。
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ ! -d "$FRONTEND" || ! -f "$FRONTEND/package.json" ]]; then
  echo "找不到前端目录：$FRONTEND"
  exit 1
fi

detect_bundles() {
  local os
  os="$(uname -s 2>/dev/null || true)"
  case "$os" in
    Darwin) echo "dmg" ;;
    Linux) echo "deb,rpm" ;;
    MINGW*|MSYS*|CYGWIN*) echo "nsis" ;;
    *)
      if [[ "${OS:-}" == "Windows_NT" ]]; then
        echo "nsis"
      else
        echo "无法识别当前平台（uname=$os OS=${OS:-}），请在 macOS / Windows / Linux 上执行。" >&2
        exit 1
      fi
      ;;
  esac
}

BUNDLES="${PACK_BUNDLES:-}"
if [[ "${1:-}" == "--bundles" ]]; then
  if [[ -z "${2:-}" ]]; then
    echo "缺少 --bundles 参数，例如：--bundles deb" >&2
    exit 1
  fi
  BUNDLES="$2"
fi
if [[ -z "$BUNDLES" ]]; then
  BUNDLES="$(detect_bundles)"
fi

echo "==> 平台：$(uname -s 2>/dev/null || echo Windows)  产物：$BUNDLES"
echo "==> 清理旧构建并重新编译"

rm -rf "$FRONTEND/dist"
if [[ -d "$FRONTEND/src-tauri/target/release/bundle" ]]; then
  rm -rf "$FRONTEND/src-tauri/target/release/bundle"
fi

echo "==> 安装依赖"
if [[ "${CI:-}" == "true" ]]; then
  bun install --cwd "$FRONTEND" --frozen-lockfile
else
  bun install --cwd "$FRONTEND"
fi

echo "==> Tauri release 构建（内置后端 + 前端 + 原生 + 安装包）"
bun run --cwd "$FRONTEND" tauri build --bundles "$BUNDLES"

echo
echo "==> 打包完成，安装包在："
echo "    $FRONTEND/src-tauri/target/release/bundle/"
find "$FRONTEND/src-tauri/target/release/bundle" -type f \( \
  -name "*.dmg" -o -name "*.exe" -o -name "*.deb" -o -name "*.rpm" \
  \) -print 2>/dev/null || true
