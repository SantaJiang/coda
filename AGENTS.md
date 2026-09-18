# Coda Agent 约定

Coda 是前后端合在一起的产品仓库：

- `frontend/`：Coda 桌面客户端
- `backend/`：后端 git 子模块（来自上游仓库）

产品侧统一使用 Coda 品牌与命名。后续改代码时遵守下面几条。

## 1. 从上游同步后端时，保住关键字替换

从远程上游把后端同步进 `backend/` 时：

- **不要还原**已经改成 Coda 的名称、环境变量、请求头、包路径和用户可见文案。
- 同步进来的**新逻辑**也要做同样的关键字适配，不能把上游品牌重新带进 Coda。

对照（上游 → Coda）：

| 上游 | Coda |
|---|---|
| 产品名 / 包名 / 目录名 | `coda`（例如 `packages/coda`） |
| `OPENCODE_CONFIG` / `OPENCODE_CONFIG_DIR` / `OPENCODE_CONFIG_CONTENT` | `CODA_CONFIG` / `CODA_CONFIG_DIR` / `CODA_CONFIG_CONTENT` |
| `x-opencode-directory` / `x-opencode-workspace` | `x-coda-directory` / `x-coda-workspace` |
| 启动入口、日志、UI、README | 只写 Coda / 后端，不写上游品牌 |

兼容期可以**同时接受**旧名，但 Coda 自己发出的请求、环境变量和文案只能用新名。

## 2. 不要把已删除或精简的功能同步回来

Coda 是精简客户端。从上游同步时，**不要重新加入**本项目已经拿掉或明确不做的能力，包括但不限于：

- MCP
- TUI / CLI 嵌入、官方 Web Console
- 输入框里展示全量供应商目录（未配置时菜单只保留「配置模型」）
- 写死的默认模型或预置密钥
- Overlay 标题栏等已经改掉的 UI

若上游新增了 Coda 需要的能力，按 Coda 的交互和命名接入，而不是整包搬回。

## 3. 提交前必须先做代码审查

每次改完、**commit 之前**：

1. 只审查**即将提交**的文件（`git status` / `git diff` 范围内）。
2. 检查正确性、回归、命名是否符合第 1 条、是否误把第 2 条的功能加回来。
3. **先修复审查出的问题**，再 `git add` 并 commit。
4. 审查未通过时不要提交。

不要把密钥、`.env`、`.coda/` 日志打进版本库。

## 4. 后端本地补丁（同步时不能丢）

`patches/backend/*.patch` 记录了 Coda 对后端子模块的**行为性改动**。这些改动只存在于本地子模块工作区，上游同步会覆盖它们，所以每次从上游同步 `backend/` 之后必须重新套用并验证：

```bash
git -C backend apply ../patches/backend/<name>.patch
```

如果上游改动了相关代码导致 apply 失败，要**手工把同等语义合并进新代码**，然后重新生成补丁文件（`git -C backend diff > patches/backend/<name>.patch`），保持补丁与子模块实际改动一致。

当前补丁清单：

| 补丁 | 位置 | 作用 |
|---|---|---|
| `session-permission-refresh-per-step.patch` | `packages/opencode/src/session/prompt.ts` 的 `runLoop` | 每个 step 循环开头重新 `sessions.get(sessionID)`，让前端**运行中**切换权限模式（PATCH `/session/:id/permission`）在下一个 step 立即生效，而不是等下一条消息。上游是在循环外只读一次快照。 |
| `prompt-failure-surface.patch` | `prompt_async` 失败处理、`SystemPrompt` 引用/技能加载、`FileSystemSearch` 的 fff 探测、技能列表排序 | 安装版 sidecar 里 `prompt_async` 崩溃后只发 `session.error`、不写助手消息、会话像没反应；补丁会把错误写回最后一条未完成助手消息并置 idle（已完成的历史轮次不再误标，崩溃早于新消息时走会话级错误卡）。`SystemPrompt.environment` 加载引用失败时必须用 `Effect.as([])` 恢复，不能 `.pipe(Effect.succeed([]))`（那会把 Effect 对象当函数调用，打包后报 `t[0] is not a function`）。同时兜住 location/fff/技能列表里的空项。 |
| `coda-model-config-prompt.patch` | `packages/opencode/src/session/system.ts` 的 `environment`、`prompt/coda-models.txt` | 系统提示写明当前是 Coda 桌面客户端、用户数据在 `~/.coda`，并给出把 OpenCode 风格 provider JSON 转成 Coda `models` 数组、同时合并进 `~/.coda/opencode.jsonc` 的步骤。避免会话里的模型把配置写到 OpenCode CLI 或 macOS Application Support。 |
| `coda-home.patch` | `packages/core/src/global.ts` | 当 `OPENCODE_CLIENT=coda` 或设置了 `CODA_HOME` 时，把 sidecar 的 config/data/cache/state/log 全部收到 `~/.coda`（默认）而不是 `~/.config/opencode` 与 `~/.local/share/opencode`。 |

以后对 `backend/` 的任何行为性修改（非第 1 条的关键字替换），都要同样落成 `patches/backend/` 下的补丁并登记到这张表里。

GitHub Actions 不能去上游拉本地独有的子模块提交。`.gitmodules` 指向公开镜像 [SantaJiang/coda-backend](https://github.com/SantaJiang/coda-backend) 的 `coda` 分支。改完后端、准备让 CI 用这份代码时，把当前 `backend` HEAD 推上去：

```bash
git -C backend push coda HEAD:coda
```

本地同步上游仍用 `anomalyco/opencode`（可加 remote 名 `upstream`）。同步、打补丁、关键字替换完成后再推到 `coda-backend`，父仓库的 gitlink SHA 才能在 Actions 里 checkout 到。

## 5. 版本号

当前软件版本是 **1.1.0**。下面四处必须保持同一个 `x.y.z`，改一处就要一起改：

| 文件 | 字段 |
|---|---|
| `frontend/package.json` | `version` |
| `frontend/src-tauri/tauri.conf.json` | `version`（GitHub Actions 以这里为准） |
| `frontend/src-tauri/Cargo.toml` | `version` |
| `frontend/src-tauri/Cargo.lock` | `name = "coda"` 那一条的 `version` |

版本含义：

- **中版本 / 主版本**：`1.0.0` → `1.1.0`，或 `1.1.0` → `2.0.0`。推到 `main` 后 GitHub Actions **会**编译并打包。
- **补丁号**（最后那位）：`1.0.0` → `1.0.1`。只用于修 bug、不发安装包，Actions **不会**打包。

不要只改补丁号却指望 CI 出包；需要新安装包就升中版本（或主版本）。

## 6. 本地自动化测试

GitHub 打包 **故意不跑测试**，直接编译安装包。测试只在本地跑，发布中版本之前必须先通过：

```bash
bun run test
```

这会执行 `frontend/` 下的 Vitest。提交前的代码审查（第 3 条）要把测试失败当成审查不通过，不要提交。

## 7. GitHub Actions 打包

工作流：`.github/workflows/release.yml`。

- **触发**：推送到 `main`，且相对上一提交的 `tauri.conf.json` 版本发生了中版本或主版本变化；或当前是 `x.y.0` 但还没有对应的 `vX.Y.0` Release（例如第一次 `1.0.0` 打包失败后的修复提交）。
- **跳过**：只改补丁号，或该中版本已经打过包。
- **手动**：GitHub Actions 里 `workflow_dispatch`，勾选 force 可对当前版本强制再打一包（例如安装包坏了要重出）。
- **平台**（每个 runner 上走 `scripts/pack.sh`，不跑 `bun test`）：
  - Windows x64 → NSIS `setup.exe`（`windows-latest`）
  - macOS Apple Silicon → `dmg`（`macos-14`，`aarch64-apple-darwin`）
  - Linux x64 → `deb`（`ubuntu-22.04`；CI 不打 rpm）
- **产物**：发布到 GitHub Release，tag 为 `vX.Y.Z`（例如 `v1.0.0`）。

CI 里后端 `bun install` 会带 `HUSKY=0`，避免子模块的 husky hook 把打包打断。本地 `./scripts/pack.sh` 默认仍按当前机器打全套（Linux 本地仍是 deb+rpm）；要用 CI 同款目标可以：

```bash
PACK_BUNDLES=deb ./scripts/pack.sh
```
