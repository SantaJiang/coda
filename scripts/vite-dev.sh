#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

stop=0
trap 'stop=1' INT TERM

while [[ "$stop" -eq 0 ]]; do
  bun run start || true
  if [[ "$stop" -eq 1 ]]; then
    break
  fi
  echo "Vite 已退出，正在重启…"
  sleep 1
done
