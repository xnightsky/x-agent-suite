# @x-agent-suite/harness

Harness 层：把真实宿主 CLI 包进 `AgentDriver` 里。

## 用途与边界

- 负责：按 `HarnessProfile` 拼装启动参数、装配隔离沙箱、写宿主配置、管理 JSONL/PTY 生命周期、归一原生证据、清理资源。
- 不负责：具体宿主的 profile（由消费者注册，本包不内建、不枚举）、判据与评分、场景编排。
- 断言纪律：只看结构化 `status`，不看退出码；CLI 不可用抛 `HarnessUnavailableError`，由调用方降级 skip。

## 模块

- `driver.ts` — `createHarnessDriver`：一次性 headless harness driver。
- `pty-driver.ts` — `createPtyAgentDriver`：PTY 长驻 driver（屏幕 idle 判定）。
- `pty-watcher.ts` / `pty-cleanup.ts` — PTY idle 判定与资源清理。
- `mcp-config.ts` — 各宿主 MCP 配置的共享构建件。
- `plugin-install.ts` — 本地插件安装（Kimi Code 形态）。
- `resolve-command.ts` — 把 harness CLI shim 解析为可直接 spawn 的形态。
- `harness-config.ts` / `harness-credentials.ts` — 借用宿主 CLI 自己的渠道配置与登录态。
- `live-config-hooks.ts` — 把借用能力注册为 `llm-fixture` 的 live-config 钩子。

## 公开入口

入口为 [`src/index.ts`](./src/index.ts)（workspace 全量导出）。**核心子路径 `@xnightsky/x-agent-suite/harness` 只含零原生子集**，以 [`packaging/entries/harness.ts`](../../packaging/entries/harness.ts) 为准：`createHarnessDriver`、宿主能力借用（`resolveHarnessChannel`、`resolveHarnessCredential`、`createHarnessLiveConfigHooks`、`resolveHarnessCommand`、`resolveLocalBinCommand`、`HarnessUnavailableError`）、共享构建件（`buildMcpServerSpec`、`writeJsonFile`、`tomlString`、`ensureJsonEntry`、`installKimiPlugins`）。

PTY 相关符号（`createPtyAgentDriver`、`createPtyScreenWatcher`、镜像工具、`cleanupPtyDriverResources`）**不在**核心子路径，需安装独立制品 `@x-agent-suite/pty-driver`。

## 最小示例

profile 由消费者注册（`headlessArgs` / `writeConfig` / `createParser`），backend 用 fixture 即零 token：

```ts
import { createHarnessDriver } from "@x-agent-suite/harness";
import { FakeProviderBackend } from "@x-agent-suite/llm-fixture";

const backend = new FakeProviderBackend({
  wire: "openai-chat",
  script: [{ text: "ok" }],
});
const driver = createHarnessDriver(profile, backend, { serverEntry: "" });
try {
  await driver.start();
  const observation = await driver.sendPrompt("hello");
  console.log(observation.toolCalls);
} finally {
  await driver.close();
}
```

可运行版本见 [`examples/tutorial/05-headless-fixture.test.ts`](../../examples/tutorial/05-headless-fixture.test.ts)；宿主 profile 的消费者侧写法见 [`tests/fixtures/profiles/`](./tests/fixtures/profiles/) 与仓库根 [`profiles/`](../../profiles/)（消费者适配投影示例，不在本包内建，也不代表已验收的宿主支持）。

## 依赖与边界

- 依赖：[`@x-agent-suite/contracts`](../contracts/README.md)（类型）、[`@x-agent-suite/driver`](../driver/README.md)（子进程/PTY 基座）、[`@x-agent-suite/sandbox`](../sandbox/README.md)（隔离沙箱）、[`@x-agent-suite/llm-fixture`](../llm-fixture/README.md)（backend）。
- 上层 `@x-agent-suite/runner`、`@x-agent-suite/recall` 通过消费者 registry 使用本包，不反向依赖。

## 分发形态

对外有**两个**制品（均由 `pnpm artifacts:pack` 产出，见 [`docs/spec/packaging.md`](../../docs/spec/packaging.md)）：

- 核心聚合包 `@xnightsky/x-agent-suite`：零原生，按 `packaging/entries/*.ts` 暴露子路径（如 `@xnightsky/x-agent-suite/harness`）。
- 独立 PTY 制品 `@x-agent-suite/pty-driver`：承载原生终端能力（依赖 `node-pty` / `@xterm/headless`），需要交互式 TUI 时显式安装。

workspace 私有包（`@x-agent-suite/*`，`private: true` + `workspace:*` 互引）**不单独发布 npm**；且其 `src/index.ts` 全量导出**不等于**核心子路径的全量导出，两者差异以 `packaging/entries/*.ts` 为准。

## 命令（在仓库根执行）

```bash
pnpm --filter @x-agent-suite/harness test       # 包级单元测试
pnpm --filter @x-agent-suite/harness typecheck  # 包级类型检查
pnpm test                                       # 全仓单元测试（收口见 pnpm check）
```

## 文档

- [`docs/spec/driver.md`](../../docs/spec/driver.md)：驱动契约与生命周期。
- [`docs/spec/pty-driver.md`](../../docs/spec/pty-driver.md)、[`docs/spec/long-lived-driver.md`](../../docs/spec/long-lived-driver.md)：PTY 与长驻驱动。
- [`docs/spec/host-config-projection.md`](../../docs/spec/host-config-projection.md)、[`docs/spec/live-auth-config.md`](../../docs/spec/live-auth-config.md)：宿主配置与凭据借用。
- [`docs/research/harness-capability-surface.md`](../../docs/research/harness-capability-surface.md)：能力面调研。
