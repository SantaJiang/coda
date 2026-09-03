#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

usage() {
  cat <<'EOF'
用法: ./scripts/clean.sh

删除可再生成的缓存与构建产物，方便拷贝或腾出磁盘：
  - 各处 node_modules
  - frontend/dist
  - frontend/src-tauri/target
  - .coda（本地日志与运行缓存）
  - .DS_Store 与 *.log

源码、锁文件和 .git 不会动。下次运行 ./run.sh 会重新安装依赖并编译。
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

size_of() {
  du -sh "$1" 2>/dev/null | awk '{print $1}'
}

echo "==> 清理前：$(size_of "$ROOT")"

echo "==> 删除 node_modules"
find "$ROOT" \
  -name .git -prune -o \
  -type d -name node_modules -prune -print -exec rm -rf {} +

echo "==> 删除前端构建产物"
for path in \
  "$ROOT/frontend/dist" \
  "$ROOT/frontend/src-tauri/target" \
  "$ROOT/.coda"
do
  if [[ -e "$path" ]]; then
    echo "$path"
    rm -rf "$path"
  fi
done

echo "==> 删除 .DS_Store 与日志"
find "$ROOT" \
  -name .git -prune -o \
  -type f \( -name .DS_Store -o -name '*.log' \) -print -delete

echo "==> 清理后：$(size_of "$ROOT")"
echo "完成。"
