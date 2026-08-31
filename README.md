# Coda

基于 OpenCode 的精简桌面 Agent 客户端：Tauri 2 + SolidJS 原生 UI，后端复用 `opencode serve`。

## 启动

在项目根目录执行：

```bash
chmod +x ./run.sh
./run.sh
```

脚本会重新构建前端、启动 OpenCode 后端（默认 `127.0.0.1:4096`），再启动 Tauri 桌面窗口。

仅浏览器调试：

```bash
./run.sh --web
```

默认模型为 `deepseek/deepseek-v4-flash`，密钥写在 `config/local.env`。
