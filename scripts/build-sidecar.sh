#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND="$ROOT/frontend"
BACKEND="$ROOT/backend"
PKG="$BACKEND/packages/cli"
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
  aarch64-apple-darwin) DIST_NAME="cli-darwin-arm64" ;;
  x86_64-apple-darwin) DIST_NAME="cli-darwin-x64" ;;
  aarch64-unknown-linux-gnu) DIST_NAME="cli-linux-arm64" ;;
  x86_64-unknown-linux-gnu) DIST_NAME="cli-linux-x64" ;;
  aarch64-pc-windows-msvc) DIST_NAME="cli-windows-arm64" ;;
  x86_64-pc-windows-msvc) DIST_NAME="cli-windows-x64" ;;
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

bun "$ROOT/scripts/backend-source.ts" --apply

echo "==> 安装后端依赖"
if [[ "${CI:-}" == "true" ]]; then
  HUSKY=0 bun install --cwd "$BACKEND" --frozen-lockfile
else
  HUSKY=0 bun install --cwd "$BACKEND"
fi

echo "==> 编译内置后端 (当前平台 ${HOST})"
# Channel 必须是 local，才会读写 opencode-local.db（与 run.sh 同源）。
# 构建版本来自后端真实 semver；local channel 保持与开发版数据库一致。
BACKEND_VERSION="$(bun -e 'console.log(JSON.parse(await Bun.file("package.json").text()).version)' --cwd "$PKG")"
if [[ -z "$BACKEND_VERSION" ]]; then
  echo "无法从 $PKG/package.json 读取 version。"
  exit 1
fi
echo "==> sidecar 版本 ${BACKEND_VERSION}（channel=local）"
# 上游构建脚本只认 OPENCODE_VERSION / OPENCODE_CHANNEL（构建入参，等价于 CLI 选项，
# 不是运行时品牌变量）。Console 的免费额度按 User-Agent 里的版本号做门槛，必须把
# 后端真实 semver 注进二进制，否则会被当成 0.0.0 拒绝。
OPENCODE_CHANNEL=local OPENCODE_VERSION="$BACKEND_VERSION" bun run --cwd "$PKG" script/build.ts --single --skip-web-ui --skip-install

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
