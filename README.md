# Coda

精简桌面 Agent 客户端。仓库按客户端与后端两个目录组织：

| 目录 | 说明 |
|---|---|
| `frontend/` | Tauri 2 + SolidJS 桌面 UI |
| `backend/` | Agent HTTP + SSE 服务（git 子模块） |

## 启动

在项目根目录执行：

```bash
chmod +x ./run.sh
./run.sh
```

脚本会启动 Coda 后端（默认 `127.0.0.1:4096`），再启动 Tauri 桌面窗口。

仅浏览器调试：

```bash
./run.sh --web
```

首次打开没有预置模型。在输入框左下角点「配置模型」，添加一个 OpenAI 兼容接口（Base URL、API Key、模型 ID）即可。

克隆后如果 `backend/` 是空的，先拉子模块：

```bash
git submodule update --init --recursive
```

## 测试

```bash
bun run test
```

只在本地跑。GitHub Actions 打包时会跳过测试，直接编译安装包。

## 打包

发布版本以 `frontend/src-tauri/tauri.conf.json` 为准，四处版本由 `bun scripts/check-versions.ts` 校验。本地：

```bash
./scripts/pack.sh
```

脚本会编译内置后端、前端与 Rust，并按当前系统生成可独立运行的安装包：macOS 为 dmg，Windows 为 exe，Linux 为 deb 与 rpm。安装后直接打开即可，不必再跑 `./run.sh`。

推到 `main` 且 **中版本号**变化时（例如 `1.0.0` → `1.1.0`），GitHub Actions 会为 Windows、macOS Apple Silicon、Linux deb 各打一包，并挂到 `vX.Y.Z` Release。只升补丁号（例如 `1.0.1`）不会打包。

开发版和安装版读写同一份用户数据，全部集中在 `~/.coda`（可用 `CODA_HOME` 覆盖）：

| 路径 | 内容 |
|---|---|
| `~/.coda/settings.json` | 界面设置、已配置模型 |
| `~/.coda/opencode.jsonc` | 运行时供应商配置 |
| `~/.coda/data/` | 会话库、凭据 |
| `~/.coda/logs/` | 后端日志 |

首次启动会把旧的 `~/Library/Application Support/ai.coda.app/settings.json`、`~/.config/opencode` 和 `~/.local/share/opencode` **复制**过来，不删除原文件。

## 开发质量检查

```bash
bun run validate
```

依次检查四处版本、后端补丁一致性、构建脚本回归、前端测试/类型/构建、Rust 格式/检查/测试，以及受影响后端链路。后端测试使用临时数据目录。GitHub 打包仍按约定不运行测试。

后端固定提交及额外补丁顺序记录在 `patches/backend/manifest.json`。开发启动和正式构建使用同一个准备步骤；干净检出会应用已登记补丁，未知本地修改会报错并保留。同步上游后须更新基线、重建补丁并验证；不依赖开发者工作区才能得到完整 sidecar。
