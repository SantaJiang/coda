#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
OPENCODE_ROOT="${OPENCODE_ROOT:-$ROOT/../opencode}"
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

export DEEPSEEK_API_KEY="${DEEPSEEK_API_KEY:-REMOVED_REVOKE_THIS_KEY}"
export OPENCODE_CONFIG="$ROOT/config/opencode.json"
export OPENCODE_CONFIG_DIR="$LOG_DIR/opencode"
export CODA_PORT="$PORT"

if [[ ! -d "$OPENCODE_ROOT" ]]; then
  echo "找不到 OpenCode 仓库：$OPENCODE_ROOT"
  echo "请把官方 opencode 放在 Coda 的同级目录，或设置 OPENCODE_ROOT。"
  exit 1
fi

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

echo "==> 安装 Coda 依赖"
bun install --cwd "$ROOT"

if [[ ! -d "$OPENCODE_ROOT/node_modules" ]]; then
  echo "==> 安装 OpenCode 依赖（首次会比较久）"
  bun install --cwd "$OPENCODE_ROOT"
fi

echo "==> 启动前端（由 Tauri / Vite 热更新，不再单独生产构建）"

kill_port "$PORT"
kill_port 1420

echo "==> 启动 OpenCode 后端  http://127.0.0.1:$PORT"
(
  cd "$OPENCODE_ROOT"
  bun --cwd "$OPENCODE_ROOT/packages/opencode" --conditions=browser src/index.ts serve --port "$PORT" --hostname 127.0.0.1
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
  bun run --cwd "$ROOT" dev
else
  echo "==> 启动 Tauri 桌面端"
  bun run --cwd "$ROOT" tauri dev
fi
