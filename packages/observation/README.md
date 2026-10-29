# @x-agent-suite/observation

Observation 层：判据调度、分数聚合与报告落盘。

## 用途

- **判据调度**：`runCriteria(options)` 按 `expect` 把已注册判据分发到各轮与会话。
- **分数聚合**：`resolveAggregate(outcomes, spec)` 按静态维度表算出出口分。
- **报告落盘**：`writeScenarioReports(rows, options)` 一次产出 `.md` 结论表与 `.json` 明细。
- **报告对比**：`diffScenarioReports(before, after, lens?)` 对比两份同场景报告。

## 不负责什么

- 不预置任何判据，也不解释 metric 名与 `expect` 值的语义（判据由消费者注册）。
- 行为断言的实现不在本包：`checks.ts` 只是 `@x-agent-suite/assertions` 的兼容重导出，新代码请直接用 `@x-agent-suite/assertions`。
- 不启动 driver，不读取被测系统，不做领域判定。

## 公开入口

| 分组     | 导出                                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------- |
| 判据调度 | `runCriteria`、`RunCriteriaOptions`                                                                               |
| 聚合     | `resolveAggregate`                                                                                                |
| 报告     | `writeScenarioReports`                                                                                            |
| 报告对比 | `diffScenarioReports`、`ReportDiffLens`、`FieldChange`、`ScenarioReportDiff`                                      |
| 检查原语 | `dryChecks`、`hardChecks`、`fuzzyChecks`、`checkListResult`、`toolNameMatches`、`toolActionMatches`（兼容重导出） |

## 最小示例（零 token）

```ts
import {
  resolveAggregate,
  runCriteria,
  writeScenarioReports,
} from "@x-agent-suite/observation";

const outcomes = await runCriteria({ session, criteria, turnExpects });
const aggregate = resolveAggregate(outcomes, {
  dimensions: [{ metric: "text-contains", knockout: true }],
});
const paths = await writeScenarioReports(rows, {
  scenarioId: "demo/main",
  outDir: ".tmp/reports",
});
```

## 设计纪律

- 工具调用判定基于结构化 `Observation.toolCalls[].status`，不能用退出码或末条文本冒充成功证据。
- 聚合机只做算术：`knockout` 短路优先，归一分不截断，`coverage` 强制披露。
- 报告默认输出到仓库根 `.tmp/reports/`。
- `scenarioId` 经 URI 编码后作为单个文件名段，报告内容保留原始值。
- 报告中的私密信息应由调用方在传入 `ScenarioReportRow` 前完成脱敏。

## 依赖与边界

- 依赖 `@x-agent-suite/contracts`（类型）与 `@x-agent-suite/assertions`（检查原语兼容重导出）。
- 不被 `assertions` 反向依赖；判据实现只在 `assertions` 一份。

## 包形态与分发

| 场景       | 导入路径                               | 形态                                            |
| ---------- | -------------------------------------- | ----------------------------------------------- |
| 本仓内     | `@x-agent-suite/observation`           | workspace 私有包（`private: true`），不单独发布 |
| 仓外消费者 | `@xnightsky/x-agent-suite/observation` | 聚合分发包 `@xnightsky/x-agent-suite` 的子路径  |

## 命令（仓库根执行）

```bash
pnpm --filter @x-agent-suite/observation typecheck
pnpm --filter @x-agent-suite/observation test
```

## 正式文档

- [场景评估](../../docs/spec/scenario-evaluation.md)：dry / hard / fuzzy 与判据分层
- [打分聚合](../../docs/spec/scoring-aggregation.md)：维度、权重与缺席映射
- [场景运行器](../../docs/spec/scenario-runner.md)：报告如何被消费
- [打包与分发](../../docs/spec/packaging.md)
