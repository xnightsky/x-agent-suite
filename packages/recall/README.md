# @x-agent-suite/recall

原生 `.recall` 声明式考卷：发现并校验 YAML → 编译为 `ScenarioSpec[]` → 复用同一个 Runner 的判据调度、repeat 与报告。

> 本包是私有 workspace 实现模块（`private: true`、版本 `0.0.0` 占位），**不单独发布到 npm**。对外使用时走聚合包子路径 `@xnightsky/x-agent-suite/recall`，装配方式见 [packaging 规范](../../docs/spec/packaging.md)。

## 用途与不负责

负责：发现 `.recall/*.{yaml,yml}`（第一层，不递归）或显式 YAML 并编译为 `ScenarioSpec[]`；把文件内 `plans` 与 `context` 编译为 `ScenarioSpec.provision`；按 Carrier kind 唯一选择执行实现（`cli` 含省略 kind → 唯一 borrowed profile，`ephemeral-client` → `clientRef` 注册的 direct Adapter，互不 fallback）；复用 Runner 执行并在报告 `metadata.recallExecution` 归因 target、mode、cliRef。

不负责：**不预置任何判据/metric**（考卷 `expect` 只按名字透传给消费者注册的 `Criterion`）；不认识任何具体宿主、CLI、provider 或协议；不读取 `x-agent-suite.config.ts`；不做执行级 ProvisionPlan，不与场景 provision 合并；不选择模型（target 由 live 配置与 TargetTags/live 审批决定）。

## 公开入口

`src/index.ts` 是唯一入口（子路径 `@xnightsky/x-agent-suite/recall` 同形导出）：

- `loadRecall` / `LoadedRecall` / `LoadRecallOptions` / `RecallExecutionPlan`：全部前置校验与装载，错误都发生在创建 Driver 之前。
- `runRecall` / `RecallRunResult` / `RecallCaseRun` / `RecallInfraFailure` / `main`：逐 target/case/repeat 执行、写出 Markdown + JSON 报告，并提供 `x-agent-suite recall` 子命令。
- `emptyRecallRegistry` / `loadRecallRegistry` / `RecallRegistry` / `RecallExecutionProfile` / `RecallProfileDriverContext`：独立注册表，只注册实现，不参与 target/mode 选择。
- `loadRecallEffectsPlan` / `RecallEffects` / `RecallEffectsProfile` / `isRecallCommandAllowed`：effects-only Plan DSL 与命令门禁。
- `materializeRecallProvision` / `readRecallResources` / `RecallCompiledResource`：provision 资源校验与隔离 cwd 物化。

## 最小示例

考卷 `.recall/queue.yaml`：

```yaml
version: 1
id: smoke
cases:
  - id: hello
    turns:
      - send: hello
        expect: { text-contains: [hello] }
```

注册表 `recall.registry.ts`（示例 Adapter 是本地 fake，不发网络请求）：

```ts
import { textContains } from "@xnightsky/x-agent-suite/assertions";
import type { RecallRegistry } from "@xnightsky/x-agent-suite/recall";

const reply = (text: string) => ({
  text,
  toolCalls: [],
  toolCallsCount: 0,
  steps: 1,
  events: [{ type: "result" as const, timestamp: 0 }],
});

export default {
  criteria: [textContains],
  profiles: {
    "consumer-client": {
      carrier: "consumer-carrier",
      createDriver: () => ({
        async start() {},
        async sendPrompt() {
          return reply("hello");
        },
        async *events() {},
        async close() {},
      }),
    },
  },
  effectsProfiles: {},
} satisfies RecallRegistry;
```

```bash
pnpm exec x-agent-suite recall --carrier consumer-carrier \
  --registry ./recall.registry.ts --out-dir ./reports .recall/
```

`--carrier` / `--provider` / `--model` 至少一个，无参数直接报定义错误；carrier 等来自 live 配置（`.env.e2e.yaml` 或 `--live-config`），示例省略该文件。上例是消费者安装聚合包后的形态，本仓库源码内等价验证用 `pnpm tutorial:recall`；真实 provider 还需 `--approve-live` 授权。

## 判据、执行参数与路由

- **判据**：由消费者在 registry 注册，Recall 只透传 `expect`。AI 断言可用 [`@x-agent-suite/assertions`](../assertions)（消费者形态 `@xnightsky/x-agent-suite/assertions`）的 `createJudgeAssertion` 薄适配后注册进 `criteria`，不新增 YAML 专用字段。
- **执行参数与路由**：`--execution-params <JSON对象>` 只交给已选 Profile/Adapter，每个 case/repeat 独立副本，不得改变 target、凭据、权限 Plan 或 live 审批；未注册、carrier 不匹配、候选不唯一或 live 未审批一律 fail-closed，不创建 Driver。

## 依赖与边界

依赖 `contracts`（类型）、`llm-fixture`（live target 与 TargetTags 决策）、`harness`（宿主 hooks）、`observation`（判据与报告）、`runner`（复用 Runner）、`yaml`；`criteria` / `driver` / `sandbox` 只作测试期 devDependency。本包不读写消费者仓库，也不感知其目录结构。

## 测试与类型检查

```bash
pnpm --filter @x-agent-suite/recall typecheck   # 包级类型检查
pnpm --filter @x-agent-suite/recall test        # 包级单元测试，零 token
pnpm test                                       # 仓库根：全部 *.test.ts，零 token
pnpm ittest                                     # 仓库根：真实宿主 CLI + 假端点，零 token
```

分层纪律：`tests/*.test.ts` 只允许 fake、loopback 与进程内组件；拉起真实宿主 CLI 的用例归 `*.ittest.ts`（仍零 token，可显式 skip）；真实 provider 只能写在 `*.token.ittest.ts`，不进入 `pnpm test` / `pnpm ittest` / `pnpm check`，必须经显式 `ittest:token:*` 脚本运行。判定表见 [testing 规范](../../docs/spec/testing.md)。

## 正式文档

- [原生 Recall 设计](../../docs/spec/recall.md)
- [ephemeral-client 与报告归因](../../docs/spec/ephemeral-client.md) / [教程导航](../../docs/tutorial/README.md)
