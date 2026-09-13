# Scenario Runner：Registry 运行时、DSL 执行与 CLI

> P3 设计稿。成功标准：声明 3+ 场景，一条命令出全部出口分。

## 目标

把「声明考卷 → 跑 → 判 → 聚合 → 报告」从消费者手工胶水升级为框架能力：
Registry 运行时（注册驱动/判据）+ `runScenarioSpec`（DSL 执行）+ CLI（一条命令）。

## 边界自查

| 检查项                | 结论                                                                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 引入具体判据名/宿主名 | 否。runner 只调度 `ScenarioSpec` 与已注册判据                                                                                                        |
| 第二个消费者          | promptfoo `eval` / Inspect 均为「声明 + 一条命令」形态，通用需求                                                                                     |
| 契约扩展              | `ScenarioSpec` 增加可选字段 `aggregate?: AggregationSpec`——聚合机已是内核能力，声明载体跟随考卷是领域中立设计（promptfoo 的 test 级 threshold 同构） |
| 不做                  | 场景文件扫描/发现、watch 模式、并行调度（YAGNI，首个消费者验证后再议）                                                                               |

## 包归属

新包 `@x-agent-suite/runner`：Registry 运行时 + DSL runner + CLI。
依赖 `contracts` / `observation`（判据调度、聚合、报告）；不依赖具体 driver 实现——
driver 由消费者经工厂注入（harness/mock/自持均可）。

## 数据流

```text
ScenarioSpec（id/turns/expect/aggregate?/metadata?）
  → createDriver(spec)（消费者工厂）
    → 逐轮 sendPrompt（turn.timeoutMs > spec.timeoutMs > 默认 60s）
      → SessionObservation
        → runCriteria（turnExpects + sessionExpect）
          → resolveAggregate（spec.aggregate 存在时）
            → ScenarioResult（artifact: { outcomes, aggregate? }）
              → writeScenarioReports
```

## API 形态

```ts
/** Registry 运行时：契约的写侧 + runner 需要的读侧。 */
export interface RuntimeRegistry extends Registry {
  driver(id: string): DriverRegistration;
  criterion(scope: "turn" | "session", name: string): Criterion;
  criteria(): readonly Criterion[];
  scenarios(): readonly Scenario<unknown, unknown>[];
}
export function createRegistry(): RuntimeRegistry;
// 重复注册 / 未找到 → 显式抛错（配置错误不等于评测失败）。

/** DSL 执行。 */
export interface RunScenarioSpecDeps {
  /** 消费者 driver 工厂（每个场景一次调用，跑完由 runner 负责 close）。 */
  readonly createDriver: (
    spec: ScenarioSpec,
  ) => AgentDriver | Promise<AgentDriver>;
  /** 本场景可用判据集。 */
  readonly criteria: readonly Criterion[];
  /** 默认轮超时（毫秒），缺省 60_000。 */
  readonly defaultTurnTimeoutMs?: number;
}
export function runScenarioSpec(
  spec: ScenarioSpec,
  deps: RunScenarioSpecDeps,
): Promise<
  ScenarioResult<{
    outcomes: readonly CriterionOutcome[];
    aggregate?: AggregateResult;
  }>
>;
```

执行语义：

- 逐轮 `sendPrompt`，超时显式抛错（基础设施失败抛错；评分不达标进 Result 不抛）；
- `dryPass` = 每轮 `dryChecks` 全过；`hardPass` = 聚合出口（无 `aggregate` 时 = 判据全过）；
  `fuzzyPass` = 判据全过；
- driver `close` 在 finally 中幂等调用。

## CLI 形态（未决事项的暂定答案）

`x-agent-suite run <config-module>`：配置文件为代码模块（TS/JS），default 导出：

```ts
export default {
  scenarios: ScenarioSpec[];          // 声明 3+ 场景
  createDriver: RunScenarioSpecDeps["createDriver"];
  criteria: Criterion[];
  outDir?: string;
};
```

**选「代码模块」而非 YAML/独立 config 格式**：判据与 driver 工厂本就是代码，
YAML 放不下函数（promptfoo 被迫逃向 `.mjs` 的前车之鉴）；`x-agent-suite.config.ts`
一等公民化留待首个消费者验证。CLI 逐场景执行并写报告，任一场景基础设施失败即非零退出。

## 验收

- Registry / runScenarioSpec 单测覆盖：注册冲突、未注册查找、逐轮执行、超时、
  expect 引用完整性（经 runCriteria）、聚合接线、close 幂等；
- CLI 端到端：mock config 声明 3 场景，一条命令跑出 md/json 报告且含 coverage；
- 教程登记与四关门禁绿。
