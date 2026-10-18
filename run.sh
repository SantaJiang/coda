#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
FRONTEND="$ROOT/frontend"
PORT="${CODA_PORT:-4096}"
MODE="${1:-tauri}"
LOG_DIR="$ROOT/.coda"
BACKEND_PID_FILE="$LOG_DIR/backend.pid"

mkdir -p "$LOG_DIR"

if [[ -f "$ROOT/config/local.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/config/local.env"
  set +a
fi

CODA_HOME="${CODA_HOME:-$HOME/.coda}"
export CODA_HOME
export CODA_CLIENT="${CODA_CLIENT:-coda}"

copy_if_missing() {
  local src="$1"
  local dest="$2"
  if [[ -e "$dest" || ! -e "$src" ]]; then
    return 0
  fi
  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest"
}

migrate_coda_home() {
  mkdir -p "$CODA_HOME/data" "$CODA_HOME/logs" "$CODA_HOME/cache" "$CODA_HOME/state"
  local settings_src
  case "$(uname -s)" in
    Darwin) settings_src="$HOME/Library/Application Support/ai.coda.app/settings.json" ;;
    MINGW*|MSYS*|CYGWIN*) settings_src="${APPDATA:-$HOME/AppData/Roaming}/ai.coda.app/settings.json" ;;
    *) settings_src="${XDG_CONFIG_HOME:-$HOME/.config}/ai.coda.app/settings.json" ;;
  esac
  copy_if_missing "$settings_src" "$CODA_HOME/settings.json"

  if [[ ! -e "$CODA_HOME/opencode.jsonc" && ! -e "$CODA_HOME/opencode.json" ]]; then
    local cfg="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
    if [[ -e "$cfg/opencode.jsonc" ]]; then
      copy_if_missing "$cfg/opencode.jsonc" "$CODA_HOME/opencode.jsonc"
    elif [[ -e "$cfg/opencode.json" ]]; then
      copy_if_missing "$cfg/opencode.json" "$CODA_HOME/opencode.json"
    elif [[ -e "$cfg/config.json" ]]; then
      copy_if_missing "$cfg/config.json" "$CODA_HOME/config.json"
    fi
  fi

  if [[ ! -e "$CODA_HOME/data/opencode-local.db" ]]; then
    local data="${XDG_DATA_HOME:-$HOME/.local/share}/opencode"
    if [[ -d "$data" ]]; then
      cp -R "$data/." "$CODA_HOME/data/" 2>/dev/null || true
    fi
  fi
}

migrate_coda_home
BACKEND_LOG="$CODA_HOME/logs/backend.log"

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

# 不给后端默认指定 CODA_CONFIG / CODA_CONFIG_DIR。
# 用户数据全部在 ~/.coda（可用 CODA_HOME 覆盖）：设置、模型、sidecar 配置、会话库。
# 调用方若已 export CODA_HOME / CODA_CONFIG*，子进程会继承。

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

kill_stale_vite() {
  # 旧的 vite-dev.sh 守护循环会不停重启 Vite，只杀监听进程会被立刻抢回端口，
  # 所以先按进程组把残留的循环整个干掉
  local pid pgid
  for pid in $(pgrep -f "vite-dev.sh" 2>/dev/null || true); do
    pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ' || true)"
    if [[ -n "${pgid:-}" ]]; then
      kill -- -"$pgid" >/dev/null 2>&1 || true
    else
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done
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

bun "$ROOT/scripts/backend-source.ts" --apply

echo "==> 安装前端依赖"
bun install --cwd "$FRONTEND"
clean_stale_rust_target

if [[ ! -d "$BACKEND_ROOT/node_modules" ]]; then
  echo "==> 安装后端依赖（首次会比较久）"
  bun install --cwd "$BACKEND_ROOT"
fi

echo "==> 启动前端（由 Tauri / Vite 热更新，不再单独生产构建）"

kill_stale_vite
kill_port "$PORT"
kill_port 1420

BACKEND_VERSION="$(bun -e 'console.log(JSON.parse(await Bun.file("package.json").text()).version)' --cwd "$PKG_DIR")"
if [[ -z "${BACKEND_VERSION:-}" ]]; then
  echo "无法从 $PKG_DIR/package.json 读取 version。"
  exit 1
fi

echo "==> 启动 Coda 后端  http://127.0.0.1:$PORT  (${BACKEND_VERSION})"
(
  cd "$BACKEND_ROOT"
  CODA_PORT="$PORT" CODA_HOME="$CODA_HOME" CODA_CLIENT="${CODA_CLIENT}" \
    CODA_DB="$CODA_HOME/data/opencode-local.db" CODA_DISABLE_AUTOUPDATE=1 \
    bun --cwd "$PKG_DIR" --conditions=browser \
      --define OPENCODE_VERSION="'${BACKEND_VERSION}'" \
      --define OPENCODE_CHANNEL="'local'" \
      --user-agent="coda/${BACKEND_VERSION}" \
      src/index.ts serve --port "$PORT" --hostname 127.0.0.1
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
