# @x-agent-suite/recall

原生 `.recall` 声明式考卷：发现并校验 YAML → 编译为 `ScenarioSpec[]` → 复用同一个 Runner 的判据调度、repeat 与报告。

> 本包是私有 workspace 实现模块（`private: true`、版本 `0.0.0` 占位），**不单独发布到 npm**。对外使用时走聚合包子路径 `@xnightsky/x-agent-suite/recall`，装配方式见 [packaging 规范](../../docs/spec/packaging.md)。

## 用途与不负责

负责：发现 `.recall/*.{yaml,yml}`（第一层，不递归）或显式 YAML 并编译为 `ScenarioSpec[]`；把文件内 `plans` 与 `context` 编译为 `ScenarioSpec.provision`；装配 case 级机械断言与内置 Judge、预检机械分值 resolver；按 Carrier kind 唯一选择执行实现（`cli` 含省略 kind → 唯一 borrowed profile，`ephemeral-client` → `clientRef` 注册的 direct Adapter，互不 fallback）；复用 Runner 执行并在报告归因 target、mode、cliRef，投影逐断言贡献与 rawScore。

不负责：**不预置任何机械判据/metric**（机械 `expect` 只按名字透传给消费者注册的 `Criterion`）；不实现 Judge 裁定、score 校验或贡献算法（这些归 Assertions）；不认识任何具体宿主、CLI、provider 或协议；不读取 `x-agent-suite.config.ts`；不做执行级 ProvisionPlan，不与场景 provision 合并；不选择模型（target 由 live 配置与 TargetTags/live 审批决定）。

## 公开入口

`src/index.ts` 是唯一入口（子路径 `@xnightsky/x-agent-suite/recall` 同形导出）：

- `loadRecall` / `LoadedRecall` / `LoadRecallOptions` / `RecallExecutionPlan`：全部前置校验与装载，错误都发生在创建 Driver 之前。
- `runRecall` / `RecallRunResult` / `RecallCaseRun` / `RecallInfraFailure` / `RecallRunEvent` / `RecallRunListener`：逐 target/case/repeat 执行、写出 Markdown + JSON 报告，并同步发出结构化进度事件。
- `createRecallReporter` / `RecallReporterOutput` / `RecallVerbosity` / `main`：0..3 级行式流式渲染与 `x-agent-suite recall` 子命令。
- `emptyRecallRegistry` / `loadRecallRegistry` / `RecallRegistry` / `RecallExecutionProfile` / `RecallProfileDriverContext`：独立注册表，只注册实现，不参与 target/mode 选择；`RecallAssertionScoreResolver` / `RecallAssertionScoreConfig` 为机械可配分值的显式 opt-in 类型。
- `loadRecallEffectsPlan` / `RecallEffects` / `RecallEffectsProfile` / `isRecallCommandAllowed`：effects-only Plan DSL 与命令门禁。
- `materializeRecallProvision` / `readRecallResources` / `RecallCompiledResource`：provision 资源校验与隔离 cwd 物化。

资源声明的 `install` 默认 true；显式 false 时跳过来源读取且禁止 destination，true 或省略时 destination 必填并相对隔离 cwd。目录沿用 `kind: directory`，不运行原生安装器；完整规则见 [resources 字段与路径](../../docs/spec/recall/recall.md#resources-字段与路径)。

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

## 流式输出与详细级别

CLI 默认在 case 完成时立即输出 `PASS/FAIL/ERROR`，结束后输出 `SUMMARY`，不再等待全量结果统一打印。详细级别单调包含：

| 级别 | 用法                  | 增加的信息                                              |
| ---- | --------------------- | ------------------------------------------------------- |
| 0    | 默认、`--verbose 0`   | case 结果、耗时、`rawScore`、断言通过数、失败原因、汇总 |
| 1    | `-v`、`--verbose`     | case/repeat 生命周期、每次 `rawScore`、报告路径         |
| 2    | `-vv`、`--verbose 2`  | turn 生命周期、逐判据 `score` 与 `contribution`         |
| 3    | `-vvv`、`--verbose 3` | 完整脱敏 prompt/Observation/repeat 结果/错误堆栈        |

`--verbose=2` 与 `--verbose 2` 等价；不同形式混用时累加，总和只允许 0..3。高级别不改变执行和退出码，详细内容使用与报告一致的 Driver redactor。级别 3 在每轮返回后输出结构化事件，不代表通用逐 token 流。完整契约见 [Recall 流式输出与 verbosity](../../docs/spec/recall/recall.md#流式输出与-verbosity)。

TTY 下自动启用图标、颜色、case 运行状态行和最终汇总框；普通日志会先清除状态行再输出，避免被下一帧覆盖。`NO_COLOR` 或 `TERM=dumb` 仅关闭颜色。非 TTY 不写任何 ANSI/光标控制，仍输出纯文本 `PASS/FAIL/SUMMARY`。

程序调用方可通过 `runRecall(options, listener)` 接收同一事件序列，或使用 `createRecallReporter(level, output)` 复用默认渲染。

`score` 是判据的 0..1 归一化结果；`contribution` 是 `hit/miss` 配置产生的实际贡献；`rawScore` 是贡献总和，`assertions=通过数/总数` 表示通过覆盖。例：`score=1 contribution=3 rawScore=3 assertions=1/1`。没有断言时不显示总分，正总分也不替代全部断言通过的 `hardPass` 条件。

## 判据、执行参数与路由

- **内置 Judge**：case 级 `expect.judge` 支持简写 rubric KV 与完整 `rubrics/timeoutMs/maxRetries/instructions`，只评最后一轮文本；每个 rubric 独立保留 boolean、reason 与贡献，`expect.decision` 不属于一期。契约见 [`docs/spec/recall/recall-judge-dsl.md`](../../docs/spec/recall/recall-judge-dsl.md)。
- **机械判据与 opt-in 分值**：其他判据由消费者在 registry 注册，expect 原样透传。静态 Criterion 与工厂均可声明 `assertionScore(expect)`，从自己的输入协议同步返回 `{hit?,miss?}`；仅实际引用在装配预检解析并按 case 缓存，非法返回/抛错在主 Driver 前拒绝。未声明时不读取插件 `input.score`，只应用默认贡献。
- **判据装配与报告**：动态工厂按已选 target 装配实际引用，每 target 一次且先于主 Driver，上下文提供同源 target/config/tags/批准/effects。报告 `artifact.outcomes` 保留原始 0..1 分数，`artifact.assertions` 保存 name/source/pass/reason/贡献，`artifact.rawScore` 为贡献之和；全部断言通过才通过。
- **执行参数与路由**：`--execution-params <JSON对象>` 只交给已选 Profile/Adapter，每个 case/repeat 独立副本，不得改变 target、凭据、权限 Plan 或 live 审批；未注册、carrier 不匹配、候选不唯一或 live 未审批一律 fail-closed，不创建 Driver。

## 依赖与边界

依赖 `assertions`（Judge 结果与直接贡献原语）、`contracts`（类型）、`judge`（批量裁定核心）、`llm-fixture`（live target 与 TargetTags 决策）、`harness`（宿主 hooks）、`observation`（判据调度与报告）、`runner`（复用 Runner）、`yaml`；`criteria` / `driver` / `sandbox` 只作测试期 devDependency。本包不读写消费者仓库，也不感知其目录结构。

## 局部有序择档

`turn.expect.firstOf.<评价点>` 与 `case.expect.firstOf.<评价点>` 接受至少两档的有序数组，每档为 `{ name, score?, expect }`。档内条件全部评价且 AND，只有齐全合法的内容 false 才进入后档；首个通过后跳过本组后档，不预创建 Judge、不影响兄弟断言。

- 各档有效 miss 必须一致；默认 `{ hit: 1, miss: -1 }`，支持 YAML 锚点。子 rubric 不允许 score，避免重复计分。
- 一个组合只产生一个顶层结果与唯一贡献；低档通过不删除标准档 false。执行、缺裁定、解析和清理错误仍为 ERROR，不降级。
- JSON 的 `assertions` 记录有效贡献，`compositions` 记录诊断树，`repeats` 记录各次完整结果；ERROR 以独立 diagnostic 文档保全，不伪造正常成绩。
- `firstOf`、`firstOf.*` 和内部组合前缀为保留名；注册判据重名会在主执行前显式拒绝，旧消费者须先迁移而不能静默换含义。

完整语法见 [firstOf 规格](../../docs/spec/recall/recall-first-of.md)，可运行的合成示例与真实验收入口见 [firstOf 场景](../../integrations/itrepos/recall-scoring/first-of/README.md)。默认零 token 验证：

```sh
pnpm exec tsx --test scripts/tests/recall-first-of-config.test.ts
```

## 测试与类型检查

```bash
pnpm --filter @x-agent-suite/recall typecheck   # 包级类型检查
pnpm --filter @x-agent-suite/recall test        # 包级单元测试，零 token
pnpm test                                       # 仓库根：全部 *.test.ts，零 token
pnpm ittest                                     # 仓库根：真实宿主 CLI + 假端点，零 token
```

分层纪律：`tests/*.test.ts` 只允许 fake、loopback 与进程内组件；拉起真实宿主 CLI 的用例归 `*.ittest.ts`（仍零 token，可显式 skip）；真实 provider 只能写在 `*.token.ittest.ts`，不进入 `pnpm test` / `pnpm ittest` / `pnpm check`，必须经显式 `ittest:token:*` 脚本运行。判定表见 [testing 规范](../../docs/spec/testing.md)。

## 正式文档

- [原生 Recall 设计](../../docs/spec/recall/recall.md)
- [ephemeral-client 与报告归因](../../docs/spec/ephemeral-client.md) / [教程导航](../../docs/tutorial/README.md)
