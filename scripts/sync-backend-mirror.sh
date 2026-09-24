#!/usr/bin/env bash
# 把父仓库钉住的 backend gitlink SHA 推到公开镜像 coda-backend 的 coda 分支，
# 这样 GitHub Actions 才能 checkout 到同一份子模块代码。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/backend"
MIRROR_URL="${CODA_BACKEND_MIRROR_URL:-git@github.com:SantaJiang/coda-backend.git}"
MIRROR_REMOTE="${CODA_BACKEND_MIRROR_REMOTE:-coda}"
MIRROR_BRANCH="${CODA_BACKEND_MIRROR_BRANCH:-coda}"

usage() {
  cat <<'EOF'
用法: ./scripts/sync-backend-mirror.sh [sha]

把指定（或当前父仓库 HEAD 上的）backend gitlink SHA 推到
SantaJiang/coda-backend 的 coda 分支。rebase 后历史分叉时会用
--force-with-lease，避免误覆盖远端新提交。

环境变量（可选）:
  CODA_BACKEND_MIRROR_URL     镜像仓库 URL（默认 git@github.com:SantaJiang/coda-backend.git）
  CODA_BACKEND_MIRROR_REMOTE  backend 仓库里的 remote 名（默认 coda）
  CODA_BACKEND_MIRROR_BRANCH  镜像分支名（默认 coda）
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ ! -d "$BACKEND/.git" && ! -f "$BACKEND/.git" ]]; then
  echo "找不到 backend 子模块：$BACKEND" >&2
  echo "请先：git submodule update --init --recursive" >&2
  exit 1
fi

if [[ -n "${1:-}" ]]; then
  SHA="$1"
else
  if ! SHA="$(git -C "$ROOT" rev-parse "HEAD:backend" 2>/dev/null)"; then
    echo "当前 HEAD 没有 backend gitlink，跳过镜像同步。" >&2
    exit 0
  fi
fi

if ! git -C "$BACKEND" cat-file -e "${SHA}^{commit}" 2>/dev/null; then
  echo "backend 工作区没有 commit ${SHA}，无法推送镜像。" >&2
  exit 1
fi

if ! git -C "$BACKEND" remote get-url "$MIRROR_REMOTE" >/dev/null 2>&1; then
  echo "==> 添加 remote $MIRROR_REMOTE -> $MIRROR_URL"
  git -C "$BACKEND" remote add "$MIRROR_REMOTE" "$MIRROR_URL"
fi

echo "==> 同步 backend ${SHA} -> ${MIRROR_REMOTE}/${MIRROR_BRANCH}"

git -C "$BACKEND" fetch --quiet "$MIRROR_REMOTE" "$MIRROR_BRANCH" 2>/dev/null || true
REMOTE_TIP="$(git -C "$BACKEND" rev-parse --verify "refs/remotes/${MIRROR_REMOTE}/${MIRROR_BRANCH}" 2>/dev/null || true)"

if [[ -n "${REMOTE_TIP}" && "${REMOTE_TIP}" == "${SHA}" ]]; then
  echo "==> 镜像已是 ${SHA}，无需推送"
  exit 0
fi

# 镜像推送只是把已有本地 SHA 挂到 CI 可读的分支上，跳过 backend 子模块
# 自带的 pre-push typecheck，避免拖慢父仓库推送。
push_mirror() {
  git -C "$BACKEND" push --no-verify "$@"
}

# 对象已在远端任意引用上时，仍把 coda 分支指到该 SHA（CI 约定跟分支 tip）。
if [[ -n "${REMOTE_TIP}" ]] && git -C "$BACKEND" merge-base --is-ancestor "${REMOTE_TIP}" "${SHA}" 2>/dev/null; then
  push_mirror "$MIRROR_REMOTE" "${SHA}:refs/heads/${MIRROR_BRANCH}"
  echo "==> 已快进推送 ${MIRROR_BRANCH} -> ${SHA}"
  exit 0
fi

if [[ -z "${REMOTE_TIP}" ]]; then
  push_mirror "$MIRROR_REMOTE" "${SHA}:refs/heads/${MIRROR_BRANCH}"
  echo "==> 已推送 ${MIRROR_BRANCH} -> ${SHA}"
  exit 0
fi

# rebase / 分叉：仅当远端 tip 未被别人改掉时才覆盖
echo "==> 远端 ${MIRROR_BRANCH} (${REMOTE_TIP}) 与本地 ${SHA} 已分叉，使用 --force-with-lease"
push_mirror \
  --force-with-lease="${MIRROR_BRANCH}:${REMOTE_TIP}" \
  "$MIRROR_REMOTE" \
  "${SHA}:refs/heads/${MIRROR_BRANCH}"
echo "==> 已强制更新 ${MIRROR_BRANCH} -> ${SHA}"
