# 模块组合手册

“穷举组合”不是把所有模块机械做笛卡尔积，而是枚举每种有意义的测试目标，并给出支持状态、前提和落点。机器可读版本在 [`catalog.json`](./catalog.json) 的 `combinations` 字段。

## 五个组合轴

| 轴      | 可选值                                                  | 谁负责选择               |
| ------- | ------------------------------------------------------- | ------------------------ |
| Driver  | mock / 自定义协议 / headless harness / long-lived / PTY | 消费者                   |
| Backend | 无 / fixture / live                                     | 仅 Harness 路径相关      |
| 编排    | 单次 / 多轮 / matrix                                    | 消费者 runner 或 matrix  |
| 评分    | dry / hard / fuzzy / enumerate / 自定义 Criterion       | 通用函数 + 消费者        |
| 输出    | Observation / ScenarioResult / Markdown+JSON            | driver、runner、reporter |

Backend 不属于 `MockDriver` 或底层 `JsonlProcess` 本身；Scenario DSL runner 也尚不是框架运行时。把“不适用”与“尚未实现”区分开，能避免产生不存在的组合。

## 支持矩阵

| 目标                        | 组合                                                  | 状态           | recipe / 详细教程                                                          |
| --------------------------- | ----------------------------------------------------- | -------------- | -------------------------------------------------------------------------- |
| 学习完整数据链              | Mock + checks + report                                | 支持           | [mock-report](./recipes/mock-report.md)（`pnpm tutorial`）                 |
| 自定义 JSONL driver         | sandbox + JsonlProcess                                | 支持           | [sandbox-jsonl](./recipes/sandbox-jsonl.md)（`pnpm tutorial:sandbox`）     |
| 测试模型 wire               | FakeProviderBackend                                   | 支持           | [fixture-backend](./recipes/fixture-backend.md)（`pnpm tutorial:fixture`） |
| 横向比较                    | Driver factory + runMatrix + report                   | 支持           | [matrix-report](./recipes/matrix-report.md)（`pnpm tutorial:matrix`）      |
| 真实 headless CLI，零 token | profile + fixture + sandbox + harness                 | 有条件         | [headless-fixture](./recipes/headless-fixture.md)；合成链可直接运行        |
| 长驻与入站                  | LongLivedAgentDriver + consumer runner                | 有条件         | [long-lived](./recipes/long-lived.md)；内存参考实现可直接运行              |
| JSON-RPC 长驻 wire          | JsonRpcPeer + LongLivedJsonRpcDriver + 消费者 adapter | 有条件         | [long-lived-wire](./recipes/long-lived-wire.md)；假 peer 链可直接运行      |
| TUI 审批                    | PTY profile + PtyAgentDriver                          | 有条件、高风险 | [pty](./recipes/pty.md)；含合成单测与真实宿主 itest 分层                   |
| Pi 真实 PTY                 | Pi profile + fake backend + PTY                       | 有条件         | [pi-pty-integration](./recipes/pi-pty-integration.md)；默认 skip，零 token |
| Pi 真实 PTY 打真实 provider/model | Pi profile + LiveBackend + 借用渠道注入           | 有条件、高风险 | [pi-live-pty](./recipes/pi-live-pty.md)；仅显式 token 入口                 |
| live 默认安全门             | authorization + redact                                | 支持           | [live-guard](./recipes/live-guard.md)；默认零网络                          |
| 真实模型最小对照            | live config + sniff                                   | 有条件、高风险 | [live-token-smoke](./recipes/live-token-smoke.md)；仅显式 token 入口       |
| `x-agent-suite run`         | Runtime Registry + DSL runner + CLI                   | 尚未实现       | 路线图阶段 1/2                                                             |

## 真实 headless CLI + fixture

先运行 [headless-fixture 详细教程](./recipes/headless-fixture.md) 验证通用机制，再替换消费者接缝。

这是最有价值的消费者主链：模型行为由 fixture 决定，CLI 仍会真实加载配置、暴露工具并调用消费者 server。

```ts
import { FakeProviderBackend } from "@x-agent-suite/llm-fixture";
import { createHarnessDriver } from "@x-agent-suite/harness";
import { fileURLToPath } from "node:url";

const backend = new FakeProviderBackend({
  wire: profile.wire,
  script: [
    {
      toolCall: {
        name: profile.toolName("demo", "perform"),
        args: { id: "42" },
      },
    },
    { text: "done" },
  ],
});
const driver = createHarnessDriver(profile, backend, {
  serverEntry: fileURLToPath(
    new URL("./consumer-mcp-entry.ts", import.meta.url),
  ),
  serverName: "demo",
});

try {
  await driver.start();
  const observation = await driver.sendPrompt("perform item 42");
  // 使用结构化 observation 评分，不刮 stdout 文本。
} finally {
  await driver.close();
}
```

消费者必须提供 `profile` 和 server 入口。入口绝对路径应在消费者运行时解析，不能硬编码进框架源码。

## 长驻会话与入站事件

可运行的内存参考实现与替换清单见 [long-lived 详细教程](./recipes/long-lived.md)。如果宿主通道是 JSON-RPC over stdio（如 ACP 类协议），可以直接复用框架的 `JsonRpcPeer` + `LongLivedJsonRpcDriver` 基座，只注入协议 adapter，见 [long-lived-wire 详细教程](./recipes/long-lived-wire.md)。

适用于多轮衰减、外部事件触达和 presence。`injectMode` 由 driver 固定声明，运行中不可切换。

```ts
await driver.start();
try {
  const first = await driver.inject("first turn");
  const inbound = await driver.waitInbound(
    (event) => event.kind === "notification",
    30_000,
  );
  const second = await driver.inject("follow-up");
} finally {
  await driver.close();
}
```

框架提供 `LongLivedAgentDriver` 契约与 JSON-RPC over stdio 的通用 wire 基座（`JsonRpcPeer` + `LongLivedJsonRpcDriver`）；其他通道形态由消费者注册具体实现，并自行决定如何把多轮 Observation 交给 Criterion。

## PTY / TUI 专项

先用 [PTY 详细教程](./recipes/pty.md) 跑合成 TUI，再用 [Pi PTY 集成教程](./recipes/pi-pty-integration.md) 验证真实宿主；两者按 `*.test.ts` / `*.ittest.ts` 分层。

PTY 只覆盖 headless 或长驻协议无法验证的交互门槛，例如审批框、首次信任或 TUI 独占输入。

```ts
import { createPtyAgentDriver } from "@x-agent-suite/harness";

const driver = createPtyAgentDriver({
  profile,
  backend,
  serverEntry,
  readyTimeoutMs: 60_000,
  promptTimeoutMs: 180_000,
});
```

前提：profile 声明 `ptyArgs`、ready/prompt pattern；运行环境安装 PTY 原生依赖；工作目录可丢弃且最小权限。PTY 屏幕用于同步，不应替代结构化工具断言。

## live 对照

默认安全门见 [live guard 详细教程](./recipes/live-guard.md)，实际 token 对照见 [live token smoke](./recipes/live-token-smoke.md)。

live 的正确顺序是：加载配置 → 解析渠道/凭据 → sniff → 限额运行 → 脱敏报告。任何一步未配置或失败都显式停止/skip。

使用 live 前必须满足：

1. 运行责任人对本次调用明确授权。
2. 使用专用 API key、企业凭据或专用测试账号。
3. 限制费用、token、并发、速率和总超时。
4. 报告和异常经过 `redactLiveSecrets`。
5. 默认教程和 CI 不运行 live。

真实测试的执行姿态（后端 fake/live × 隔离 沙箱/非沙箱 × 凭证三级阶梯）及逐组合的风险闸门表，统一维护在根目录 [README「真实测试姿态」](../../README.md)，本手册不重复维护。

## Matrix 组合

Matrix 只要求消费者提供四个接缝：

```ts
await runMatrix(
  {
    carriers,
    getVariants,
    createDriver,
    runScenario,
  },
  { scenarioId },
);
```

- `carriers`：driver/profile 标识集合。
- `getVariants`：发现 prompt 变体。
- `createDriver`：把 carrier 解析成 AgentDriver。
- `runScenario`：发送 prompt、收 artifact、执行 criterion、返回 ScenarioResult。

单个 carrier 创建、运行或关闭失败会成为 skip 行，不中断其他组合。

## 当前不要组合的东西

- `MockDriver + LiveBackend`：mock 不拥有模型渠道，组合没有语义。
- `JsonlProcess + Criterion` 直接耦合：先在自定义 Driver 中归一成 Observation，再评分。
- `PTY + stdout 文本断言`：屏幕布局会漂移，PTY 只负责交互和同步。
- `Registry + 自动文件扫描`：当前没有运行时实现，也没有确认同步/异步和扫描策略。
- 宿主借用 helper + 默认 live：借用登录态属于高风险迁移路径，必须显式配置和授权。

## 外部消费者安装

源码 workspace 包是 private。当前先在本仓生成版本化制品，再由消费者安装：

```bash
pnpm artifacts:pack
```

具体 tarball 文件名、固定版本重打和外部 `pnpm add` 方式见[打包规范](../spec/packaging.md)。Registry/CLI 上线后再增加统一配置文件与命令教程。
