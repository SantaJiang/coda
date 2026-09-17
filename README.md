# Coda

精简桌面 Agent 客户端。仓库按两个子模块组织：

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

当前版本 **1.0.0**。本地：

```bash
./scripts/pack.sh
```

脚本会编译内置后端、前端与 Rust，并按当前系统生成可独立运行的安装包：macOS 为 dmg，Windows 为 exe，Linux 为 deb 与 rpm。安装后直接打开即可，不必再跑 `./run.sh`。

推到 `main` 且 **中版本号**变化时（例如 `1.0.0` → `1.1.0`），GitHub Actions 会为 Windows、macOS Apple Silicon、Linux deb 各打一包，并挂到 `vX.Y.Z` Release。只升补丁号（例如 `1.0.1`）不会打包。

开发版和安装版读写同一份用户数据：会话在 `~/.local/share/opencode`，模型与界面设置在系统的 Coda 配置目录。
