# 本地开发与验证

使用 Bun 和 Rust stable（至少 1.89，设置文件使用标准库文件锁）。版本号以 `frontend/package.json` 为准，四处版本字段由脚本统一检查。

```bash
bun install
bun run backend:prepare
bun run validate
```

`backend:prepare` 仅向清单指定的干净基准应用已登记补丁；发现未知修改会停止并保留工作区。不要用重置工作区来绕过检查。后端行为改动提交后，将清单 `revision` 与父仓库 gitlink 指向新提交，保留 `base` 与补丁系列用于重建核对，避免重复应用已提交补丁。更新后端后，同时维护 `patches/backend/manifest.json`、补丁及 `AGENTS.md`。启动和打包也会核对源码。

`validate` 覆盖工具脚本、前端测试/类型/生产构建、Rust 格式/锁定依赖/测试、后端包类型检查及受影响测试。后端测试使用临时 `CODA_HOME`，不读取或改写真实用户配置。发布工作流保持只编译打包，本地验证必须先完成。

提交前按 `AGENTS.md` 复审改动，检查品牌、协议兼容性和已移除能力。新增异步状态写入需处理请求过期、删除及项目切换；配置持久化只提交变化字段。终端数据契约以共享样本 `config/contracts/terminal-record.json` 跨语言验证。

当前架构及本轮修复证据见 `docs/architecture-audit/2026-10-18-results.md`。平台交互验证不能由单元测试或编译替代；未测平台应明确记录。
