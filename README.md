# Coda

精简桌面 Agent 客户端：Tauri 2 + SolidJS 原生 UI，后端以 HTTP + SSE 提供 Agent 能力。

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

## 打包

```bash
./scripts/pack.sh
```

脚本会重新编译，并按当前系统生成安装包：macOS 为 dmg，Windows 为 exe，Linux 为 deb 与 rpm。
