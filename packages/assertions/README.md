# @x-agent-suite/assertions

领域中立的行为断言子包：检查层原语、确定性判据与 AI 断言的唯一实现处。

## 用途

- **检查层原语**：`dryChecks`（结构门禁）、`hardChecks`（工具调用与入参）、`fuzzyChecks`（文本兜底）、`checkListResult`（列举逐条核对）。
- **三个确定性判据**：`textContains`、`textNotContains`、`toolCall`，均为 `TurnCriterion`，注册后由每轮 `expect` 按名引用。
- **一个薄 AI 断言**：`createJudgeAssertion` 把 `judge()` 的具名裁定包成 `TurnCriterion`。

## 不负责什么

- 不认识具体被测系统、宿主或领域判据名；通用判据由调用方显式选用，AI 判据名、rubric 与期望值由调用方给出。
- 不自动注册判据、不调度、不聚合、不写报告（调度与聚合在 `@x-agent-suite/observation`）。
- 不创建模型客户端，不做渠道、模式决策或审批；只有调用方执行 AI 判据时，才经 `judge()` 调用注入的 client。

## 公开入口

| 分组       | 导出                                                             |
| ---------- | ---------------------------------------------------------------- |
| 工具匹配   | `toolNameMatches`、`toolActionMatches`                           |
| 检查原语   | `dryChecks`、`hardChecks`、`fuzzyChecks`、`checkListResult`      |
| 确定性判据 | `textContains`、`textNotContains`、`toolCall`、`ToolCallExpect`  |
| AI 断言    | `createJudgeAssertion`、`JudgeAssertionOptions`                  |
| 契约类型   | `EnumerateCheck`、`EnumerateResult`、`HardExpectation`（重导出） |

`dryChecks` / `hardChecks` / `fuzzyChecks` 返回失败原因列表，空数组即通过；`checkListResult` 返回 `hallucinated` / `missing`。`hardChecks` 的 `args` 是浅层 JSON 相等，`toolCall` 的 `args` 是递归子集约束——两者刻意不同。

## 最小示例（零 token）

`turn`、`session`、`observation` 为 `@x-agent-suite/contracts` 的观测对象，示例省略其字段。

```ts
import {
  fuzzyChecks,
  hardChecks,
  textContains,
  toolCall,
} from "@x-agent-suite/assertions";

textContains.evaluate(turn, { turnIndex: 0, session, expect: ["只读"] });
toolCall.evaluate(turn, {
  turnIndex: 0,
  session,
  expect: { tool: "read", args: { path: "a.txt" } },
});
hardChecks(observation, { tool: "read", action: "get" }); // [] 即通过
fuzzyChecks("只读完成", ["只读", /完成$/]);
```

AI 断言用注入的 fake client，零 token：

```ts
import { createJudgeAssertion } from "@x-agent-suite/assertions";

const criterion = createJudgeAssertion({
  name: "answer-quality",
  client: {
    complete: async () => ({
      text: '{"grounded":{"pass":true,"reason":"有证据"}}',
    }),
  },
  timeoutMs: 1000,
  maxRetries: 0,
});

await criterion.evaluate(turn, {
  turnIndex: 0,
  session,
  expect: [{ name: "grounded", rubric: "回答是否基于观测证据" }],
});
```

rubric 清单来自该轮 `expect`，形状由 `judge()` 现有校验把关。执行失败抛 `[not-evaluated:<kind>]`，模型未返回某项 rubric 抛 `[absent]`，只有明确 `pass:false` 才产出 0 分。

## 依赖与边界

- 依赖 `@x-agent-suite/contracts`（类型）与 `@x-agent-suite/judge`（AI 断言执行）。
- `@x-agent-suite/criteria` 与 `@x-agent-suite/observation` 的相关符号只作兼容重导出；本包不反向依赖它们。

## 包形态与分发

| 场景       | 导入路径                              | 形态                                            |
| ---------- | ------------------------------------- | ----------------------------------------------- |
| 本仓内     | `@x-agent-suite/assertions`           | workspace 私有包（`private: true`），不单独发布 |
| 仓外消费者 | `@xnightsky/x-agent-suite/assertions` | 聚合分发包 `@xnightsky/x-agent-suite` 的子路径  |

## 命令（仓库根执行）

```bash
pnpm --filter @x-agent-suite/assertions typecheck
pnpm --filter @x-agent-suite/assertions test
```

## 正式文档

- [场景评估](../../docs/spec/scenario-evaluation.md)：判据如何进入评分
- [打分聚合](../../docs/spec/scoring-aggregation.md)：判据结果如何变成出口分
- [通用 AI Judge](../../docs/spec/judge.md)：AI 断言的底层执行器
- [打包与分发](../../docs/spec/packaging.md)：聚合子路径机制
