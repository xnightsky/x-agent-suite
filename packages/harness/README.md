# @x-agent-suite/harness

Harness 层：把真实宿主 CLI 包进 `AgentDriver` 里。

## 模块

- `driver.ts` — `createHarnessDriver`：一次性 headless harness driver。
- `pty-driver.ts` — `createPtyAgentDriver`：PTY 长驻 driver（屏幕 idle 判定）。
- `pty-watcher.ts` / `pty-cleanup.ts` — PTY idle 判定与资源清理。
- `mcp-config.ts` — 各宿主 MCP 配置的共享构建件。
- `plugin-install.ts` — 本地插件安装（Kimi Code 形态）。
- `resolve-command.ts` — 把 harness CLI shim 解析为可直接 spawn 的形态。
- `harness-config.ts` / `harness-credentials.ts` — 借用宿主 CLI 自己的渠道配置与登录态。
- `live-config-hooks.ts` — 把借用能力注册为 `llm-fixture` 的 live-config 钩子。

## 设计纪律

- 具体宿主 profile 由消费者注册；本包不内建、不导出也不枚举具体宿主。
- 断言只看结构化 `status`，不看退出码。
- CLI 不可用抛 `HarnessUnavailableError`，由调用方降级 skip。
