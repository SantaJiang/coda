#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
FRONTEND="$ROOT/frontend"
PORT="${CODA_PORT:-4096}"
MODE="${1:-tauri}"
LOG_DIR="$ROOT/.coda"
BACKEND_LOG="$LOG_DIR/backend.log"
BACKEND_PID_FILE="$LOG_DIR/backend.pid"

mkdir -p "$LOG_DIR"

if [[ -f "$ROOT/config/local.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/config/local.env"
  set +a
fi

find_backend_root() {
  if [[ -n "${CODA_BACKEND_ROOT:-}" && -d "$CODA_BACKEND_ROOT" ]]; then
    echo "$CODA_BACKEND_ROOT"
    return 0
  fi
  if [[ -d "$ROOT/backend" ]]; then
    echo "$ROOT/backend"
    return 0
  fi
  return 1
}

backend_pkg_dir() {
  local root="$1"
  if [[ -d "$root/packages/coda" && -f "$root/packages/coda/src/index.ts" ]]; then
    echo "$root/packages/coda"
    return 0
  fi
  local pkg
  for pkg in "$root/packages/"*; do
    if [[ -f "$pkg/src/cli/cmd/serve.ts" && -f "$pkg/src/index.ts" ]]; then
      echo "$pkg"
      return 0
    fi
  done
  if [[ -f "$root/src/cli/cmd/serve.ts" && -f "$root/src/index.ts" ]]; then
    echo "$root"
    return 0
  fi
  return 1
}

BACKEND_ROOT="$(find_backend_root || true)"
if [[ -z "${BACKEND_ROOT:-}" ]]; then
  echo "找不到 Coda 后端。"
  echo "请初始化 git 子模块：git submodule update --init --recursive"
  echo "或设置 CODA_BACKEND_ROOT。"
  exit 1
fi

PKG_DIR="$(backend_pkg_dir "$BACKEND_ROOT" || true)"
if [[ -z "${PKG_DIR:-}" ]]; then
  echo "后端仓库 $BACKEND_ROOT 里找不到可启动的 serve 入口。"
  exit 1
fi

if [[ ! -d "$FRONTEND" || ! -f "$FRONTEND/package.json" ]]; then
  echo "找不到前端目录：$FRONTEND"
  exit 1
fi

export CODA_CONFIG="${CODA_CONFIG:-$ROOT/config/coda.json}"
export CODA_CONFIG_DIR="${CODA_CONFIG_DIR:-$LOG_DIR/backend}"
export CODA_PORT="$PORT"

kill_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids="$(lsof -ti tcp:"$port" || true)"
    if [[ -n "$pids" ]]; then
      echo "释放端口 $port"
      # shellcheck disable=SC2086
      kill $pids >/dev/null 2>&1 || true
      sleep 0.4
    fi
  fi
}

cleanup() {
  if [[ -f "$BACKEND_PID_FILE" ]]; then
    local pid
    pid="$(cat "$BACKEND_PID_FILE" || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
    rm -f "$BACKEND_PID_FILE"
  fi
}

trap cleanup EXIT INT TERM

clean_stale_rust_target() {
  local target="$FRONTEND/src-tauri/target"
  local build_dir="$target/debug/build"
  [[ -d "$build_dir" ]] || return 0

  local dep
  dep="$(find "$build_dir" -name '*.d' -print -quit 2>/dev/null || true)"
  [[ -n "$dep" ]] || return 0

  # Cargo 会把绝对 OUT_DIR 写进 *.d。仓库搬迁后，tauri-build 仍会去旧路径
  # 读插件权限文件。旧检测写的是 /coda/src-tauri/，匹配不到 frontend/src-tauri。
  if grep -q '/src-tauri/target/' "$dep" && ! grep -Fq "$target" "$dep"; then
    echo "==> 清理过期的 Rust 构建缓存"
    rm -rf "$target"
  fi
}

echo "==> 安装前端依赖"
bun install --cwd "$FRONTEND"
clean_stale_rust_target

if [[ ! -d "$BACKEND_ROOT/node_modules" ]]; then
  echo "==> 安装后端依赖（首次会比较久）"
  bun install --cwd "$BACKEND_ROOT"
fi

echo "==> 启动前端（由 Tauri / Vite 热更新，不再单独生产构建）"

kill_port "$PORT"
kill_port 1420

echo "==> 启动 Coda 后端  http://127.0.0.1:$PORT"
(
  cd "$BACKEND_ROOT"
  bun --cwd "$PKG_DIR" --conditions=browser src/index.ts serve --port "$PORT" --hostname 127.0.0.1
) >"$BACKEND_LOG" 2>&1 &
echo $! >"$BACKEND_PID_FILE"

echo "==> 等待后端就绪"
ready=0
for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:$PORT/global/health" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.5
done

if [[ "$ready" != "1" ]]; then
  echo "后端没有在 30s 内就绪，最近日志："
  tail -n 80 "$BACKEND_LOG" || true
  exit 1
fi

echo "后端已就绪。"

if [[ "$MODE" == "--web" || "$MODE" == "web" ]]; then
  echo "==> 启动 Vite 前端  http://localhost:1420"
  bun run --cwd "$FRONTEND" dev
else
  echo "==> 启动 Tauri 桌面端"
  bun run --cwd "$FRONTEND" tauri dev
fi
