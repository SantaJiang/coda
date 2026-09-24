#!/usr/bin/env bash
# 把本仓库的 git hooks 指到 scripts/githooks（含推送前自动同步 backend 镜像）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

git config core.hooksPath scripts/githooks
chmod +x scripts/githooks/pre-push scripts/sync-backend-mirror.sh

echo "已设置 core.hooksPath=scripts/githooks"
echo "推送父仓库且 backend gitlink 变化时，会自动运行 sync-backend-mirror.sh"
