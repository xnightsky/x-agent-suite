# @x-agent-suite/judge

通用 AI Judge：把一批具名 rubric 交给模型，取回具名 boolean 裁定。

## 用途

- `judge(input, options)`：一次批量调用，产出 `{ name, pass, reason }` 列表。
- `createJudgeClient(options)`：按通用 TargetTags 决策创建客户端，`direct`（API）或 `borrowed`（CLI）。
- 单项缺失进 `absent`，整体调用或解析失败进 `not-evaluated`，两者严格分层。

## 不负责什么

- **AI 不出分**：不产出 score、confidence、threshold 或 overall pass。
- 不实现 `Criterion`，不接 Recall / decision / 聚合 / 报告落盘 / 跨 case 调度。
- 需要「AI 断言作为判据」时，用 `@x-agent-suite/assertions` 的 `createJudgeAssertion`——它对 `TurnCriterion` 做薄适配，本包保持与判据层解耦。
- `judge()` 不读取答案文件、不自行获取答案；`input.output` 是唯一被判文本。
- 不维护 Judge 专用渠道注册表，执行失败不跨 mode 回退。

## 公开入口

| 分组     | 导出                                                                                                                                                                                                      |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 运行时   | `judge`、`createJudgeClient`、`JudgeDefinitionError`、`JudgeModelError`                                                                                                                                   |
| 输入输出 | `JudgeInput`、`JudgeOutcome`、`JudgeVerdict`、`JudgeRubric`、`JudgeFailure`、`JudgeFailureKind`、`JudgeOptions`                                                                                           |
| 客户端   | `JudgeModelClient`、`JudgeModelRequest`、`JudgeModelResponse`、`JudgeClient`、`JudgeMode`、`CreateJudgeClientOptions`、`DirectJudgeClientOptions`、`BorrowedJudgeClientOptions`、`JudgeClientBaseOptions` |

## 最小示例（fake client，零 token）

```ts
import { judge } from "@x-agent-suite/judge";

const outcome = await judge(
  {
    output: "只读完成，未修改文件",
    rubrics: [{ name: "grounded", rubric: "回答是否基于观测证据" }],
  },
  {
    client: { complete: async () => ({ text: '{"grounded":true}' }) },
    timeoutMs: 1000,
    maxRetries: 0,
  },
);
// outcome.status === "completed"
// outcome.verdicts[0] => { name: "grounded", pass: true, reason: "" }
```

`completed` 只表示调用与解析完成，**不代表内容通过**；全部 rubric 都 absent 也仍是 `completed`。

## 真实 provider 调用

会消耗真实 token，必须显式授权与配置：`createJudgeClient` 需要完整 target 与 TargetTags 唯一候选；`review-required` 目标还需本次 `liveReviewApproved`，direct 与 borrowed 之间不做失败回退。绑定方式见 [judge.md](../../docs/spec/judge.md) 与 [target-tags.md](../../docs/spec/target-tags.md)。

## 依赖与边界

- 依赖 `@x-agent-suite/contracts`（类型）与 `@x-agent-suite/llm-fixture`（live 配置与 transport）。
- `@x-agent-suite/assertions` 复用本包完成 AI 判据适配；本包不反向依赖断言、判据、Recall 或 runner。

## 包形态与分发

| 场景       | 导入路径                         | 形态                                            |
| ---------- | -------------------------------- | ----------------------------------------------- |
| 本仓内     | `@x-agent-suite/judge`           | workspace 私有包（`private: true`），不单独发布 |
| 仓外消费者 | `@xnightsky/x-agent-suite/judge` | 聚合分发包 `@xnightsky/x-agent-suite` 的子路径  |

## 命令（仓库根执行）

```bash
pnpm --filter @x-agent-suite/judge typecheck
pnpm --filter @x-agent-suite/judge test
```

真实模型的验收用例是 token 级测试，只能显式运行：`pnpm ittest:token:judge`。

## 正式文档

- [通用 AI Judge](../../docs/spec/judge.md)：契约与不变量
- [TargetTags 决策](../../docs/spec/target-tags.md)：direct / borrowed 如何选定
- [LLM Fixture](../../docs/spec/llm-fixture.md)：target 解析与 transport
- [场景评估](../../docs/spec/scenario-evaluation.md)：Judge 在评分体系中的位置
