# Coda Agent 约定

Coda 的后端来自上游仓库，产品侧统一使用 Coda 品牌与命名。后续改代码时遵守下面三条。

## 1. 从上游同步后端时，保住关键字替换

从远程 opencode 仓库把后端同步进当前项目（目标目录优先 `backend/`）时：

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
