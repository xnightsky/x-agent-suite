# @x-agent-suite/recall

原生 `.recall` 声明式考卷：发现并校验 YAML → 编译为 `ScenarioSpec[]` → 复用同一个 Runner 的判据调度、repeat 与报告。

> 本包是私有 workspace 实现模块（`private: true`、版本 `0.0.0` 占位），**不单独发布到 npm**。对外使用时走聚合包子路径 `@xnightsky/x-agent-suite/recall`，装配方式见 [packaging 规范](../../docs/spec/packaging.md)。

## 用途与不负责

负责：发现 `.recall/*.{yaml,yml}`（第一层，不递归）或显式 YAML 并编译为 `ScenarioSpec[]`；把文件内 `plans` 与 `context` 编译为 `ScenarioSpec.provision`；装配 case 级机械断言与内置 Judge、预检机械分值 resolver；按 Carrier kind 唯一选择执行实现（`cli` 含省略 kind → 唯一 borrowed profile，`ephemeral-client` → `clientRef` 注册的 direct Adapter，互不 fallback）；复用 Runner 执行并在报告归因 target、mode、cliRef，投影逐断言贡献与 rawScore。

不负责：**不预置任何机械判据/metric**（机械 `expect` 只按名字透传给消费者注册的 `Criterion`）；不实现 Judge 裁定、score 校验或贡献算法（这些归 Assertions）；不认识任何具体宿主、CLI、provider 或协议；不读取 `x-agent-suite.config.ts`；不做执行级 ProvisionPlan，不与场景 provision 合并；不选择模型（target 由 live 配置与 TargetTags/live 审批决定）。

## 公开入口

`src/index.ts` 是唯一入口（子路径 `@xnightsky/x-agent-suite/recall` 同形导出）：

- `loadRecall` / `LoadedRecall` / `LoadRecallOptions` / `RecallExecutionPlan`：全部前置校验与装载，错误都发生在创建 Driver 之前。
- `runRecall` / `RecallRunResult` / `RecallCaseRun` / `RecallInfraFailure` / `main`：逐 target/case/repeat 执行、写出 Markdown + JSON 报告，并提供 `x-agent-suite recall` 子命令。
- `emptyRecallRegistry` / `loadRecallRegistry` / `RecallRegistry` / `RecallExecutionProfile` / `RecallProfileDriverContext`：独立注册表，只注册实现，不参与 target/mode 选择；`RecallAssertionScoreResolver` / `RecallAssertionScoreConfig` 为机械可配分值的显式 opt-in 类型。
- `loadRecallEffectsPlan` / `RecallEffects` / `RecallEffectsProfile` / `isRecallCommandAllowed`：effects-only Plan DSL 与命令门禁。
- `materializeRecallProvision` / `readRecallResources` / `RecallCompiledResource`：provision 资源校验与隔离 cwd 物化。

资源声明的 `install` 默认 true；显式 false 时跳过来源读取且禁止 destination，true 或省略时 destination 必填并相对隔离 cwd。目录沿用 `kind: directory`，不运行原生安装器；完整规则见 [resources 字段与路径](../../docs/spec/recall.md#resources-字段与路径)。

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

- **内置 Judge**：case 级 `expect.judge` 支持简写 rubric KV 与完整 `rubrics/timeoutMs/maxRetries/instructions`，只评最后一轮文本；每个 rubric 独立保留 boolean、reason 与贡献，`expect.decision` 不属于一期。契约见 [`docs/spec/recall-judge-dsl.md`](../../docs/spec/recall-judge-dsl.md)。
- **机械判据与 opt-in 分值**：其他判据由消费者在 registry 注册，expect 原样透传。静态 Criterion 与工厂均可声明 `assertionScore(expect)`，从自己的输入协议同步返回 `{hit?,miss?}`；仅实际引用在装配预检解析并按 case 缓存，非法返回/抛错在主 Driver 前拒绝。未声明时不读取插件 `input.score`，只应用默认贡献。
- **判据装配与报告**：动态工厂按已选 target 装配实际引用，每 target 一次且先于主 Driver，上下文提供同源 target/config/tags/批准/effects。报告 `artifact.outcomes` 保留原始 0..1 分数，`artifact.assertions` 保存 name/source/pass/reason/贡献，`artifact.rawScore` 为贡献之和；全部断言通过才通过。
- **执行参数与路由**：`--execution-params <JSON对象>` 只交给已选 Profile/Adapter，每个 case/repeat 独立副本，不得改变 target、凭据、权限 Plan 或 live 审批；未注册、carrier 不匹配、候选不唯一或 live 未审批一律 fail-closed，不创建 Driver。

## 依赖与边界

依赖 `assertions`（Judge 结果与直接贡献原语）、`contracts`（类型）、`judge`（批量裁定核心）、`llm-fixture`（live target 与 TargetTags 决策）、`harness`（宿主 hooks）、`observation`（判据调度与报告）、`runner`（复用 Runner）、`yaml`；`criteria` / `driver` / `sandbox` 只作测试期 devDependency。本包不读写消费者仓库，也不感知其目录结构。

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
