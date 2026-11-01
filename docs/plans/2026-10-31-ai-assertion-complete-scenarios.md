# 内置 Judge、精确 Decision 与完整测试场景 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 case 级 `expect.judge` 与 `expect.decision` 实现为 Recall 内置标准能力，以 KV 裁定池、精确命中器和静态聚合完成从 YAML 到 JSON 报告的完整链路。

**Architecture:** 作者侧 KV 在 Recall 编译层转换为 `JudgeRubric[]`、具名判据结果和 `DimensionSpec[]`，现有 `resolveAggregate` 继续作为唯一静态评分机。内置 Judge 只评 case 最后一轮输出，默认复用主执行同源配置，每次 attempt 创建独立 backend/Driver。

**Tech Stack:** TypeScript、Node.js test runner、YAML、pnpm。

**Spec:** [`docs/spec/recall-judge-dsl.md`](../spec/recall-judge-dsl.md)、[`docs/spec/scoring-aggregation.md`](../spec/scoring-aggregation.md)、[`docs/spec/testing.md`](../spec/testing.md)

## 阅读路径

1. 先读规格的“第一阶段总览”，确认 `turns` 与 case 级 `expect` 分离。
2. 再读 `judge` 的 KV 简写/完整形态与 `decision.dimensions` 的精确命中器。
3. 然后读编译与执行分层，理解作者 KV 如何降低为现有数组和聚合契约。
4. 最后按 Task 1–5 查看实现步骤与验收命令。

## 第一阶段作者接口

```yaml
cases:
  - id: routing
    turns:
      - send: 先阅读规则并准备回答
      - send: 现在给出最终结论
    expect:
      judge:
        timeoutMs: 30000
        maxRetries: 2
        instructions: 只根据最终回答中的证据判断
        rubrics:
          ownership: { rubric: 是否说明归 author 侧 }
          polite: { rubric: 措辞是否礼貌 }
          concise: { rubric: 是否简洁 }
      decision:
        threshold: 0.5
        dimensions:
          chosen_skill:
            eq: recall-author
            knockout: true
          reasoning:
            verdict: judge.ownership
            weight: 3
          style_ok:
            verdict: [judge.polite, judge.concise]
            absent: fail
```

简写 `judge` 直接是 KV 裁定池；完整对象把裁定池放入 `rubrics`。`eq / one_of` 从最终回答抽取字面值，`verdict` 引用 Judge，`metric` 引用其他判据结果。每维必须恰选一种来源。

## 固定执行数据

主 transport 第一轮返回“正在准备”，第二轮返回：

```text
chosen_skill: recall-author
写新队列属于 author 侧。措辞礼貌且简洁。
```

测试必须证明 Judge 与字面命中器只接收第二轮文本。PASS 固定响应为：

```json
{
  "ownership": { "pass": true, "reason": "归属明确" },
  "polite": { "pass": true, "reason": "措辞礼貌" },
  "concise": { "pass": true, "reason": "表达简洁" }
}
```

## Global Constraints

- 第一阶段只实现 case 级 `expect.judge / expect.decision`，只评最后一轮输出。
- 不实现逐轮 Judge、AI 条件分支、动态后续提示词或提前终止。
- 作者接口使用 KV；执行层继续使用数组，不为对齐内部实现把列表暴露给考卷作者。
- 每维恰选 `eq / one_of / verdict / metric`；`from` 仅用于字面维。
- 简单 `CriterionResult.score` 保持 0/1；decision 的 rawScore 与归一分只由 `resolveAggregate` 出口。
- 未引用 rubric 自动形成 `weight=1`、`knockout=false`、`absent=zero` 的隐式维度。
- 默认测试使用临时工作区、合成配置和 fake transport，保持零网络、零 token。
- `turn:judge` 与 `turn:judge.*` 保持标准保留命名空间，其他自定义判据继续沿用 registry。
- 新行为先写失败测试，再实现最小生产改动。

## Review Focus

- 多轮 case 的准备轮答案不得进入 Judge 或字面命中器；Task 1 与 Task 4 分别固定编译位置和官方 CLI 证据。
- KV 重复键、保留键、带点名称与未知 verdict 引用必须在主 Driver 前失败；Task 1 覆盖。
- `eq / one_of` 缺抽取值不得猜测为 false，必须进入 absent；Task 2 与 Task 4 覆盖。
- 作者维度名与命中来源不得互相覆盖；Task 2 固定报告中的 `name` 与 `metric`。
- `ScenarioSpec.expandOutcomes` 只能展开显式列名判据，既有 `createJudgeAssertion + aggregate` 保持单结果兼容；Task 2 覆盖。
- 异步 borrowed 创建、取消与迟到 Driver 不得泄漏；Task 3 覆盖。

---

### Task 1: 落地 case 级 expect schema 与 KV 编译

**Files:**

- Create: `packages/recall/src/judge-dsl.ts`
- Modify: `packages/recall/src/schema.ts`
- Modify: `packages/recall/src/compile.ts`
- Modify: `packages/recall/src/registry.ts`
- Modify: `packages/recall/tests/compile.test.ts`
- Modify: `packages/recall/tests/registry.test.ts`

**Interfaces:**

- `RecallCaseDefinition.expect` 承载内置 `judge` 与 `decision`；执行 `turns` 不声明这两个内置字段。
- `RecallJudgeDeclaration` 支持 KV 简写与 `{ rubrics, timeoutMs?, maxRetries?, instructions? }`。
- `RecallDecisionDeclaration` 为 `{ threshold?, dimensions: Record<string, RecallDimensionDeclaration> }`。
- 编译把内置 Judge 输入只接到最后一轮，并输出 `ScenarioSpec.aggregate` 与 `ScenarioSpec.expandOutcomes = ["judge"]`（使用 judge 的 decision 路径）。

- [ ] **Step 1: 编写 schema 与编译失败测试**

  - case 级 KV 简写和完整 judge 对象均可编译，turn 内内置 judge/decision 被拒绝。
  - 重复 YAML key、保留键简写、带点名称、未知字段和空 rubric 得到定义错误。
  - 每维缺少或同时声明多个命中来源被拒绝。
  - `verdict` 不带 `judge.` 前缀或引用未知 rubric 被拒绝。
  - 多轮 case 仅最后一轮接收内置 Judge 与字面判据输入。
  - 未引用 rubric 自动形成默认维度，自定义 `turn:judge` 与 `turn:judge.custom` 被保留命名空间拒绝。

- [ ] **Step 2: 运行编译与 registry 测试，确认新增断言按预期失败**

  ```bash
  pnpm exec tsx --test packages/recall/tests/compile.test.ts packages/recall/tests/registry.test.ts
  ```

- [ ] **Step 3: 实现封闭 schema、KV 归一、引用校验与最后一轮编译**
- [ ] **Step 4: 重跑 Task 1 测试并确认通过**

### Task 2: 实现精确命中、具名维度与多值 outcome

**Files:**

- Create: `packages/recall/src/decision-assertion.ts`
- Create: `packages/recall/tests/decision-assertion.test.ts`
- Modify: `packages/contracts/src/criterion.ts`
- Modify: `packages/contracts/src/aggregation.ts`
- Modify: `packages/contracts/src/dsl.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/tests/contracts.test.ts`
- Modify: `packages/assertions/src/judge-assertion.ts`
- Modify: `packages/assertions/tests/judge-assertion.test.ts`
- Modify: `packages/observation/src/criteria-runner.ts`
- Modify: `packages/observation/src/aggregation.ts`
- Modify: `packages/observation/tests/observation-criteria-runner.test.ts`
- Modify: `packages/observation/tests/observation-aggregation.test.ts`
- Modify: `packages/runner/src/run-scenario.ts`
- Modify: `packages/runner/tests/run-scenario.test.ts`

**Interfaces:**

- `TurnCriterionGroup extends TurnCriterion`，增加 `evaluateMany()`；简单 `evaluate()` 保持现有行为。
- `TurnCriterionOutcome.state?: "evaluated" | "absent"`，缺省 evaluated，缺失 verdict 必须产生显式 absent outcome。
- `ScenarioSpec.expandOutcomes` 与 `RunCriteriaOptions.expandOutcomes` 使用判据名数组，仅显式列出的 group 展开。
- `DimensionSpec.name?` 与 `DimensionOutcome.name?` 保留作者维度 KV key；`metric` 继续保存命中来源。
- 字面维编译为确定性判据结果，`verdict / metric` 编译为结果引用，统一进入 `resolveAggregate`。

- [ ] **Step 1: 编写精确命中与多值结果失败测试**

  - `eq` trim、大小写不敏感；`one_of` 任一候选命中。
  - 默认行约定使用维度 key，自定义 `from` 必须含一个捕获组。
  - 抽取缺失产生 absent，不得当成明确 false。
  - `verdict` 字符串与数组 OR、隐式维、coverage、weight 与 knockout 正确。
  - 报告同时保留作者 `name` 与来源 `metric`。
  - 显式 expandOutcomes 时产生实际与 absent outcomes；未声明时既有 Judge + aggregate 保持原单结果名称。
  - `TurnCriterionGroup` 与新增维度字段经 `@x-agent-suite/contracts` 公开入口可用。

- [ ] **Step 2: 运行相关测试并确认新增接口导致预期失败**
- [ ] **Step 3: 实现字面判据、具名维度与兼容的多值调度**
- [ ] **Step 4: 重跑 Task 2 测试并确认通过**

### Task 3: 装配主 AI 同源的标准 Judge

**Files:**

- Create: `packages/recall/src/judge-assembly.ts`
- Create: `packages/recall/tests/judge-assembly.test.ts`
- Modify: `packages/recall/src/criterion-assembly.ts`
- Modify: `packages/recall/package.json`
- Modify: `packages/judge/src/types.ts`
- Modify: `packages/judge/src/client.ts`
- Modify: `packages/judge/tests/client.test.ts`
- Modify: `packages/judge/tests/client-cancel.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- `createRecallJudgeAssertion(options): TurnCriterionGroup` 创建标准判据。
- `assembleRecallCriteria()` 在发现 case 级 `expect.judge` 时追加标准判据，每 target 一次。
- `@x-agent-suite/assertions` 成为 recall 的运行时依赖。

- [ ] **Step 1: 编写 direct/borrowed 装配失败测试**

  - direct 接收同源 target/config/tags/live 批准、mode 与 transport。
  - borrowed 接收同源 cliRef/profile，并生成独立单轮 spec、effects:none 和空执行参数。
  - borrowed 支持异步 profile 工厂；异步创建成功、取消期间挂起及迟到 Driver 的 finally close 均有测试。
  - 装配阶段记录零 transport、零 Driver 调用。
  - 无 `expect.judge` 时保持现有自定义判据集合。

- [ ] **Step 2: 运行 `packages/recall/tests/judge-assembly.test.ts`，确认模块与行为缺口导致失败**
- [ ] **Step 3: 实现标准 Judge 装配**
- [ ] **Step 4: 重跑 Task 3 测试并确认通过**

### Task 4: 建立第一阶段的官方 CLI 全链场景

**Files:**

- Create: `packages/recall/tests/recall-judge-assertion.test.ts`
- Create: `packages/recall/tests/recall-judge-decision.test.ts`
- Modify: `packages/recall/tests/fixtures/recall.registry.ts`
- Modify: `packages/recall/tests/fixtures/recall-workspace.ts`

**Interfaces:**

- 考卷使用 case 级 `expect.judge` 与 `expect.decision`。
- fake transport 按主执行 prompt 与 `policy: judge-v1` 分流响应。
- 测试状态记录主执行文本、Judge prompt 并在每次工作区创建时重置。

- [ ] **Step 1: 编写简单四场景**

  | 场景                | 预期证据                                                     |
  | ------------------- | ------------------------------------------------------------ |
  | PASS + 多轮最终回答 | CLI=0；准备轮不进入 Judge；最终回答和完整 rubric 进入 prompt |
  | 明确 FAIL           | CLI=0；报告保留失败 rubric 与 reason                         |
  | absent              | CLI=1；failure 含 `[absent]` 与缺项名                        |
  | not-evaluated       | CLI=1；failure 含 `[not-evaluated:`，诊断隐藏合成 secret     |

- [ ] **Step 2: 编写 decision 五场景**

  | 场景                         | 预期证据                                              |
  | ---------------------------- | ----------------------------------------------------- |
  | `eq` + 默认行约定 + knockout | 精确选中字段；命中/未命中与否决原因正确               |
  | `one_of` + 自定义 `from`     | 任一候选命中；无捕获时进入 absent                     |
  | verdict 权重 + OR + 隐式维   | 显式权重精确生效，未引用 rubric 仍参与，coverage 正确 |
  | decision absent 映射         | 缺 verdict 或缺字面值进入对应映射，内容结果 CLI=0     |
  | metric 混合判据              | 确定性 metric 与 `judge.<rubric>` 进入同一静态出口    |

- [ ] **Step 3: 运行两个目标测试并记录实现缺口**

  ```bash
  pnpm exec tsx --test packages/recall/tests/recall-judge-assertion.test.ts packages/recall/tests/recall-judge-decision.test.ts
  ```

- [ ] **Step 4: 完成 fixture 并重跑，确认九个场景全部通过**

### Task 5: 同步文档并执行回归

**Files:**

- Modify: `docs/spec/recall-judge-dsl.md`
- Modify: `docs/spec/recall.md`
- Modify: `docs/spec/judge.md`
- Modify: `docs/spec/testing.md`
- Modify: `docs/spec/scenario-dsl.md`
- Modify: `docs/spec/contracts.md`
- Modify: `docs/spec/scenario-runner.md`
- Modify: `docs/spec/scenario-evaluation.md`
- Modify: `docs/spec/scoring-aggregation.md`
- Modify: `docs/spec/recall-runtime-composition.md`
- Modify: `docs/spec/boundary-discipline.md`
- Modify: `docs/tutorial/recipes/recall.md`
- Modify: `docs/research/model-graded-assertion-testing.md`
- Modify: `docs/research/README.md`
- Modify: `docs/README.md`
- Modify: `docs/spec/README.md`
- Modify: `packages/assertions/README.md`
- Modify: `packages/recall/README.md`

- [ ] **Step 1: 登记实际契约与测试证据**

  文档保持 case 级 `expect`、KV 作者接口、精确命中器、最后一轮评价和后续发展方向一致；不提前登记逐轮或条件控制为已交付能力。

- [ ] **Step 2: 运行相关包回归**

  ```bash
  pnpm --filter @x-agent-suite/contracts test
  pnpm --filter @x-agent-suite/assertions test
  pnpm --filter @x-agent-suite/observation test
  pnpm --filter @x-agent-suite/runner test
  pnpm --filter @x-agent-suite/recall test
  pnpm --filter @x-agent-suite/judge test
  ```

- [ ] **Step 3: 执行仓库收口**

  ```bash
  pnpm check
  pnpm format:check
  git diff --check
  ```

  Expected: boundary、typecheck、test、ittest 和文档检查全部通过；ittest 按现有显式前置条件运行或 skip。

## 后续验证入口

- **逐轮与条件控制调研：** 分别评估逐轮断言、跨轮计分、动态提示词和提前终止，不把研究方向当作第一阶段接口。
- **真实 live 冒烟：** 使用 case 级 `expect.judge`，运行明显 PASS 与 FAIL，记录 target、Judge 版本、退出码、清理和脱敏结果。
- **Judge 质量评估：** 建立固定输出的人工标注开发集与保留集，报告一致率、混淆矩阵、偏差切片、未评测计数和重复裁判翻转率。
- **可选 grader/Driver 扩展：** 出现第二个明确消费者需求时，新增独立设计，扩展 Judge 的显式选择与归因。
