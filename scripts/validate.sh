#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
bun scripts/check-versions.ts
bun scripts/backend-source.ts
bun test --timeout 30000 scripts/backend-source.test.ts scripts/check-versions.test.ts
bun run test
bun run --cwd frontend build
(cd frontend/src-tauri && cargo fmt --all -- --check && cargo check --locked && cargo test --locked)
bun run --cwd backend/packages/core typecheck
bun run --cwd backend/packages/opencode typecheck
TEST_DATA="$(mktemp -d)"
trap 'rm -rf "$TEST_DATA"' EXIT
(cd backend/packages/core && bun test --timeout 30000 test/flag-coda.test.ts)
(cd backend/packages/opencode && CODA_HOME="$TEST_DATA" bun test --timeout 30000 test/effect/runtime-flags.test.ts test/terminal test/tool/shell.test.ts test/session/prompt.test.ts test/session/tools.test.ts test/session/retry.test.ts test/server/coda-config-disposal.test.ts)
git diff --check
git -C backend diff --check
