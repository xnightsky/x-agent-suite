# @x-agent-suite/assertions

领域中立的行为断言子包：检查层原语、确定性判据与 AI 断言的唯一实现处。

## 用途

- **检查层原语**：`dryChecks`（结构门禁）、`hardChecks`（工具调用与入参）、`fuzzyChecks`（文本兜底）、`checkListResult`（列举逐条核对）。
- **四个确定性判据**：`textContains`、`textNotContains`、`toolCall`、`evidence`，均为 `TurnCriterion`，注册后由每轮 `expect` 按名引用。
- **AI 断言适配**：`createJudgeAssertion` 把 `judge()` 的具名裁定包成 `TurnCriterion`；`judgeAssertionResults` 将同一 `JudgeOutcome` 展开为逐 rubric 的原始 name/pass/reason/0..1 结果，两者共用 absent/not-evaluated 语义。
- **直接贡献原语**：`parseAssertionScore` 封闭校验 `{hit?,miss?}`，`assertionContribution` 独立应用 hit=1/miss=-1 默认并计算 `pass ? hit : miss`；`AssertionDetail` 与原始 CriterionOutcome 分离，不回写其 0..1 score。

## 不负责什么

- 不认识具体被测系统、宿主或领域判据名；通用判据由调用方显式选用，AI 判据名、rubric 与期望值由调用方给出。
- 不自动注册判据、不调度、不聚合、不写报告（调度与聚合在 `@x-agent-suite/observation`）。
- 默认不创建模型客户端，不做渠道、模式决策或审批；只有调用方显式选择 `clientOptions` 时，才通过原生 Judge 工厂创建 client。
- 不读取环境或 Recall 配置，不自行选择 target，不保存永久批准。
- 不复制 Judge prompt、timeout、retry、verdict 解析、失败分类或资源清理。

## 公开入口

| 分组         | 导出                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| 工具匹配     | `toolNameMatches`、`toolActionMatches`                                                                                   |
| 检查原语     | `dryChecks`、`hardChecks`、`fuzzyChecks`、`checkListResult`                                                              |
| 确定性判据   | `textContains`、`textNotContains`、`toolCall`、`ToolCallExpect`                                                          |
| 访问痕迹证据 | `evidence`、`createEvidenceCriterion`、`EvidenceExpect`；输出/路径原语 `extractToolOutputText`、`normalizeWorkspacePath` |
| AI 断言      | `createJudgeAssertion`、`judgeAssertionResults`、`JudgeAssertionOptions`、`NamedAssertionResult`                         |
| 直接贡献     | `parseAssertionScore`、`assertionContribution`、`AssertionScoreConfig`、`AssertionScoreResolver`、`AssertionDetail`      |
| 契约类型     | `EnumerateCheck`、`EnumerateResult`、`HardExpectation`（重导出）                                                         |

`@x-agent-suite/assertions/evidence` 与 `@x-agent-suite/assertions/judge` 分别提供访问痕迹证据和 AI 断言适配的窄入口；根入口继续重导出相同符号。

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

Recall 的内置 case 级 `expect.judge` 与完整执行配置已实现，`expect.decision` 不属于一期，见 [`docs/spec/recall-judge-dsl.md`](../../docs/spec/recall-judge-dsl.md)。该路径复用本包的 `judgeAssertionResults` 多值 verdict 适配与直接贡献原语；作者侧 KV 在编译层转换为现有数组接口。

### AI 断言的两种 client 入口（互斥）

`JudgeAssertionOptions` 是判别联合，`client` 与 `clientOptions` 必须恰有一个（TypeScript 类型排除歧义，运行时双填或缺失均抛 `TypeError`）：

```ts
// 分支一：注入现成客户端（fake / 自定义 / 零 token 测试）
const injected = createJudgeAssertion({ name: "answer-quality", client });

// 分支二：原生 Judge 工厂配置，创建判据时同步完成纯决策装配
const fromOptions = createJudgeAssertion({
  name: "answer-quality",
  clientOptions: {
    target,
    tags,
    liveReviewApproved,
    mode: "direct",
    transport,
  },
});
```

`clientOptions` 分支在 `createJudgeAssertion` 调用时同步调用一次原生 `createJudgeClient`；该工厂构造期只做参数校验与 TargetTags 决策，不启动 Driver、不联网、不调用模型，attempt 资源仍由每次 `complete()` 创建与清理。类型层从「必填 client 的 interface」改为判别联合属于破坏性变更（本包 `0.0.0` private，影响可接受）。

## 依赖与边界

- 依赖 `@x-agent-suite/contracts`（类型）与 `@x-agent-suite/judge`（AI 断言执行）。
- `@x-agent-suite/criteria` 与 `@x-agent-suite/observation` 的相关符号只作兼容重导出；本包不反向依赖它们。

## 包形态与分发

| 场景               | 导入路径                                       | 形态                                            |
| ------------------ | ---------------------------------------------- | ----------------------------------------------- |
| 本仓内             | `@x-agent-suite/assertions`                    | workspace 私有包（`private: true`），不单独发布 |
| 仓外消费者         | `@xnightsky/x-agent-suite/assertions`          | 聚合分发包 `@xnightsky/x-agent-suite` 的子路径  |
| 本仓证据子路径     | `@x-agent-suite/assertions/evidence`           | 与根入口共享同一实现                            |
| 仓外证据子路径     | `@xnightsky/x-agent-suite/assertions/evidence` | 聚合包内独立 JS/声明入口                        |
| 本仓 AI 断言子路径 | `@x-agent-suite/assertions/judge`              | 仅 AI 断言适配，不替代底层 Judge 入口           |
| 仓外 AI 断言子路径 | `@xnightsky/x-agent-suite/assertions/judge`    | 聚合包内独立 JS/声明入口                        |

## 命令（仓库根执行）

```bash
pnpm --filter @x-agent-suite/assertions typecheck
pnpm --filter @x-agent-suite/assertions test
```

## 正式文档

- [场景评估](../../docs/spec/scenario-evaluation.md)：判据如何进入评分
- [访问痕迹证据断言](../../docs/spec/evidence-assertions.md)：非空读取、workspace 路径、引用与组合
- [打分聚合](../../docs/spec/scoring-aggregation.md)：判据结果如何变成出口分
- [通用 AI Judge](../../docs/spec/judge.md)：AI 断言的底层执行器
- [打包与分发](../../docs/spec/packaging.md)：聚合子路径机制

## 有序择档原语

`evaluateFirstOf(branches, onEvent?)` 顺序调用懒分支，只有合法的 `pass=false` 才继续；首个通过短路，任何异常或非法结果都抛出。返回原始 0/1 结果与唯一 `contribution`、接受档和分支诊断；共同 miss 必须一致，不将跳过分支变为 false/0 分。阶段事件是深拷贝快照，监听器异常仍显式失败。

`assertCriterionResult` 是通用结果形状校验，Observation 调度与择档原语共用它；不预置任何领域判据。Recall 的 DSL/Driver 装配仍留在 Recall，见 [firstOf 规格](../../docs/spec/recall-first-of.md)。
