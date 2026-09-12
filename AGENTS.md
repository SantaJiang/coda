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

以后对 `backend/` 的任何行为性修改（非第 1 条的关键字替换），都要同样落成 `patches/backend/` 下的补丁并登记到这张表里。
