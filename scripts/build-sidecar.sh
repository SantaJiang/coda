#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND="$ROOT/frontend"
BACKEND="$ROOT/backend"
PKG="$BACKEND/packages/opencode"
BIN_DIR="$FRONTEND/src-tauri/binaries"

if [[ ! -f "$PKG/src/index.ts" || ! -f "$PKG/script/build.ts" ]]; then
  echo "找不到可编译的后端：$PKG"
  echo "请先初始化子模块：git submodule update --init --recursive"
  exit 1
fi

if ! command -v rustc >/dev/null 2>&1; then
  echo "找不到 rustc，无法确定 sidecar 目标三元组。"
  exit 1
fi

HOST="$(rustc -vV | awk '/^host: / { print $2 }')"
if [[ -z "$HOST" ]]; then
  echo "无法从 rustc -vV 读取 host 三元组。"
  exit 1
fi

case "$HOST" in
  aarch64-apple-darwin) DIST_NAME="opencode-darwin-arm64" ;;
  x86_64-apple-darwin) DIST_NAME="opencode-darwin-x64" ;;
  aarch64-unknown-linux-gnu) DIST_NAME="opencode-linux-arm64" ;;
  x86_64-unknown-linux-gnu) DIST_NAME="opencode-linux-x64" ;;
  aarch64-pc-windows-msvc) DIST_NAME="opencode-windows-arm64" ;;
  x86_64-pc-windows-msvc) DIST_NAME="opencode-windows-x64" ;;
  *)
    echo "当前平台 ${HOST} 没有对应的后端发布产物命名。"
    exit 1
    ;;
esac

SRC_BIN="$PKG/dist/$DIST_NAME/bin/opencode"
DEST="$BIN_DIR/coda-backend-${HOST}"
if [[ "$HOST" == *windows* ]]; then
  SRC_BIN="${SRC_BIN}.exe"
  DEST="${DEST}.exe"
fi

echo "==> 安装后端依赖"
bun install --cwd "$BACKEND"

echo "==> 编译内置后端 (当前平台 ${HOST})"
# 与 run.sh 的源码后端同一 channel，才会读写 opencode-local.db
OPENCODE_CHANNEL=local bun run --cwd "$PKG" script/build.ts --single --skip-embed-web-ui --skip-install

if [[ ! -f "$SRC_BIN" ]]; then
  echo "后端编译完成，但找不到二进制：$SRC_BIN"
  exit 1
fi

mkdir -p "$BIN_DIR"
rm -f "$BIN_DIR"/coda-backend-*
cp "$SRC_BIN" "$DEST"
chmod +x "$DEST"
if [[ "$(uname -s 2>/dev/null || true)" == "Darwin" ]]; then
  ENTITLEMENTS="$FRONTEND/src-tauri/Entitlements.plist"
  if [[ -f "$ENTITLEMENTS" ]]; then
    codesign --force --sign - --options runtime --entitlements "$ENTITLEMENTS" "$DEST"
  fi
fi
echo "==> sidecar：$DEST"
