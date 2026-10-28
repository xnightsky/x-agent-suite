# @x-agent-suite/runner

场景运行器：Registry 运行时 + `ScenarioSpec` 执行 + 一条命令出报告的 CLI。

> 本包是私有 workspace 实现模块（`private: true`、版本 `0.0.0` 占位），**不单独发布到 npm**。对外使用时走聚合包子路径 `x-agent-suite/runner`，装配方式见 [packaging 规范](../../docs/spec/packaging.md)。

## 用途与不负责

负责：

- Registry 运行时：注册并查找 driver、criterion、scenario，重复注册与未命中显式抛错；
- `runScenarioSpec`：逐轮 `sendPrompt` → `SessionObservation` → 判据调度 → 可选聚合 → `ScenarioResult`；
- `runScenarioRepeat` / `summarizeRepeat`：同场景重复执行与稳定率统计；
- CLI `eval`：加载消费者 config 模块，逐场景执行并写 Markdown + JSON 报告。

不负责：

- 不内置任何 driver、profile、scenario 或具体判据名，全部由消费者注入；
- 不做场景文件扫描/发现、watch 模式或并行调度；
- 不决定模型与凭据，也不发起 provider 调用——那是 driver 与 live 决策层的事。

## 公开入口

`src/index.ts` 是唯一入口（子路径 `x-agent-suite/runner` 同形导出）：

- `createRegistry` / `RuntimeRegistry`：契约写侧 + runner 需要的读侧。
- `runScenarioSpec` / `RunScenarioSpecDeps` / `RunnerArtifact`：单场景执行与产物（判定明细 + 可选聚合）。
- `runScenarioRepeat` / `summarizeRepeat` / `RepeatRun`：重复执行与统计。
- `main` / `loadRunConfig` / `RunConfig`：CLI 与 config 模块装载。

## 最小示例

config 模块 `run.config.ts`（示例 driver 是本地 fake，不发网络请求）：

```ts
import { textContains } from "x-agent-suite/assertions";
import type { RunConfig } from "x-agent-suite/runner";

export default {
  scenarios: [
    {
      id: "hello",
      turns: [{ send: "hello", expect: { "text-contains": ["hello"] } }],
    },
  ],
  createDriver: () => ({
    async start() {},
    async sendPrompt() {
      return {
        text: "hello",
        toolCalls: [],
        toolCallsCount: 0,
        steps: 1,
        events: [{ type: "result" as const, timestamp: 0 }],
      };
    },
    async *events() {},
    async close() {},
  }),
  criteria: [textContains],
  outDir: ".tmp/reports",
} satisfies RunConfig;
```

```bash
pnpm exec x-agent-suite eval ./run.config.ts
```

程序化调用同一语义：

```ts
import { runScenarioSpec } from "x-agent-suite/runner";

const result = await runScenarioSpec(scenario, { createDriver, criteria });
```

上例命令是消费者安装聚合包后的形态，本仓库源码内等价验证用 `pnpm tutorial:runner`。真实 provider 与真实宿主 CLI 需要 live 审批/显式授权，最小示例只覆盖零 token 的 fake 路径。

## 依赖与边界

依赖 `contracts`（类型）、`observation`（判据调度、聚合、报告）、`assertions`（`dryChecks` 薄适配）；`driver` / `criteria` 只作测试期 devDependency。**不依赖任何具体 driver 实现**：harness、mock 或消费者自持 driver 都经 `createDriver` 注入。`.recall` 声明式考卷不经过本包 CLI，见 [`@x-agent-suite/recall`](../recall)。

## 测试与类型检查

```bash
pnpm --filter @x-agent-suite/runner typecheck   # 包级类型检查
pnpm --filter @x-agent-suite/runner test        # 包级单元测试，零 token
pnpm test                                       # 仓库根：全部 *.test.ts，零 token
pnpm ittest                                     # 仓库根：真实宿主 CLI + 假端点，零 token
```

分层纪律：拉起真实宿主 CLI 的用例归 `*.ittest.ts`（仍零 token、可显式 skip）；真实 provider 只能写在 `*.token.ittest.ts`，必须经显式 `ittest:token:*` 脚本运行，不进入 `pnpm test` / `pnpm ittest` / `pnpm check`。判定表见 [testing 规范](../../docs/spec/testing.md)。

## 正式文档

- [Scenario Runner 设计](../../docs/spec/scenario-runner.md)
- [核心契约](../../docs/spec/contracts.md)
- [Scenario DSL](../../docs/spec/scenario-dsl.md)
- [教程导航](../../docs/tutorial/README.md)
