---
title: "Recall 内置 Judge 与断言直接计分实施计划"
type: plan
status: active
tags: [plan, 2026-10-31-ai-assertion-complete-scenarios]
---

# Recall 内置 Judge 与断言直接计分实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本轮由当前会话 inline 执行；按任务授权不 commit、不 push、不拉队友。

**Goal:** 让真实 Recall 作者配置经编译、主执行、机械判据与批量 Judge 后，产出逐项直接计分、固定全通过判断和官方 CLI 报告。

**Architecture:** 继续复用 `ScenarioSpec.expect`、通用 Runner、`runCriteria` 与 `@x-agent-suite/judge` 的裁定/解析/重试核心。Recall 在编译元数据中保留内置 Judge 配置，以内部会话判据键展开 rubric；每个 rubric 复用同一 case 的一次批量裁定。原始 `CriterionOutcome.score` 原样保留既有 0..1 分数，报告前另建私有 `artifact.assertions` 贡献明细，还原作者名、补充机械／AI 来源并求 `rawScore`。异步 Driver 创建、取消和迟到清理由 Recall 私有 model client 承接，不修改 contracts、Runner 或 Judge 公共契约；机械可配分值只增加 Recall registry 的显式 opt-in resolver。

**Tech Stack:** TypeScript、Node `node:test`、YAML、pnpm workspace、现有 fake transport / 合成 registry / AgentDriver。

**Spec:** [Recall 内置 Judge 与断言计分 DSL](../spec/recall/recall-judge-dsl.md)

## Global Constraints

- 一期只实现 case 级 `expect.judge` 与断言直接计分；不实现 classification、turn 级内置 Judge、branch、`onFail` 或 Decision。
- `packages/*/src/` 不识别任何具体被测系统，不读写消费者仓库；机械判据继续由消费者 registry 注册并接收原始 expect 输入。
- `score` 缺省或空对象等价于 `{ hit: 1, miss: -1 }`，部分覆盖独立应用默认值；分值必须是有限数。
- `rawScore` 是细项贡献的算术和；case 通过要求全部已声明断言 `pass=true`，正分不能抵消失败。
- Judge 只接收最后一轮 `turn.text`；score 不进入 Judge prompt 或裁定协议。
- absent、not-evaluated、缺少判据结果、超时、解析和调用失败均为评测错误，不转成内容 miss 或 0 分。
- 定义错误 CLI=2 且不创建主 Driver/Judge；评测错误 CLI=1；内容未通过 CLI=0。
- 无 `expect.judge` 不新增模型调用；既有独立 Assertions、通用 Judge 与通用聚合公开行为不变。
- 默认测试只用 fake transport、合成 registry/Driver，零 token；禁止运行 `ittest:token:*` 或启用 live。
- 单文件不超过 500 行，导出符号写中文 JSDoc；本轮不 commit、不 push、不做远程写入。

## Review Focus

- 机械判据返回畸形结果或根本没有结果：必须在写正常评分报告前成为 CLI=1，而不是被当成 false。
- Judge 只返回部分 rubric：即使其他 rubric 有明确 boolean，也必须整体成为评测错误。
- 异步 profile 在 abort 后才返回 Driver：迟到 Driver 必须 close，且不得 start/send。
- borrowed Judge 与主执行 effects 不同：Judge 必须收到独立单轮 spec、`effects:none`、空 executionParams，不继承主 provision。
- 同一 rubric 名出现在多个 case／repeat：每次 case/repeat 只批量调用一次，不共享主 Driver 或上一次裁定。

## File Structure

- Create `packages/assertions/src/judge-results.ts`、`score.ts`：逐 rubric 原始结果、score 封闭校验、独立默认与直接贡献。
- Modify `packages/assertions/src/judge-assertion.ts`：旧单结果 AI 断言复用同一逐 rubric 适配，公开行为不变。
- Modify `packages/observation/src/criteria-runner.ts`：统一校验 CriterionResult 的 boolean/reason/0..1 有限 score。
- Create `packages/recall/src/assertion-dsl.ts`：case expect 的 Judge schema、内部键展开与作者元数据。
- Create `packages/recall/src/judge-criterion.ts`：最后文本与 scenario rubric 装配，每 case 复用一次批量 `judge()`。
- Create `packages/recall/src/judge-driver.ts`：同源独立 Driver model client；只负责创建、取消、迟到关闭和 finally 清理。
- Create `packages/recall/src/assertion-score.ts`：调用通用 resolver 并按 execution/scenario 缓存配置，不实现分值算法。
- Create `packages/recall/src/assertion-results.ts`：还原作者名并组合通用贡献细项，求报告 `rawScore`。
- Modify `packages/recall/src/schema.ts`、`compile.ts`、`criterion-assembly.ts`、`run.ts`：作者 DSL、registry 装配和报告接线。
- Modify `packages/recall/package.json`、`pnpm-lock.yaml`：增加现有 assertions/judge workspace 依赖。
- Create focused tests；不修改 contracts、Runner 或 Judge 公共签名，不改通用聚合。

### Task 1: 两轮四细项官方 CLI 纵向切片

**Files:**

- Create: `packages/recall/tests/recall-judge-assertion.test.ts`
- Create: `packages/recall/tests/fixtures/recall-judge.registry.ts`
- Create/Modify: 上述 Recall 实现文件（仅本切片需要的最小路径）

**Interfaces:**

- Consumes: 现有 `judge(input, options)`、`createRecallDriver()`、`runScenarioRepeat()`、`writeScenarioReports()`。
- Produces: 原始 `result.artifact.outcomes[]` 原样保留 0..1 标准分；新增 `result.artifact.assertions[]` 保存作者名、`source: "mechanical" | "ai"`、`pass/reason/score` 贡献，以及 `result.artifact.rawScore`。

- [x] **Step 1: 先写真实失败测试**

配置两轮主执行、机械 A pass 默认 +1、机械 B fail 默认 -1、AI A pass `hit:3`、AI B fail `miss:0`。通过统一 `packaging/cli.ts recall` 入口执行并断言：退出码 0、`hardPass=false`、`rawScore=3`、四个细项各出现一次，Judge 只收到最终文本且 prompt 不含分值。

- [x] **Step 2: 运行并记录 RED**

Run: `pnpm exec tsx --test packages/recall/tests/recall-judge-assertion.test.ts`
Expected: FAIL，原因是 case 级 `expect` 尚未进入 Recall schema／执行链；不得先写生产实现让该测试变绿。

- [x] **Step 3: 写最小实现**

在 schema/compile 中接受并展开 case expect；装配会话机械判据和每 rubric 内部判据；本 boolean fixture 返回 1/0，既有 0..1 原始分不改写。在 Recall 报告私有 assertions 中按 pass 与 AI 声明计算贡献、还原名称、补来源与直接总分。

- [x] **Step 4: 运行 GREEN 与既有 Recall 回归**

Run: `pnpm exec tsx --test packages/recall/tests/recall-judge-assertion.test.ts && pnpm --dir packages/recall test`
Expected: 新算例通过，既有 Recall 测试全通过；无 Judge 的旧测试调用数不增加。

### Task 2: 作者 DSL 与固定计分矩阵

**Files:**

- Modify: `packages/recall/src/assertion-dsl.ts`、`schema.ts`、`compile.ts`
- Test: `packages/recall/tests/recall-judge-schema.test.ts`、`recall-assertion-scoring.test.ts`

**Interfaces:**

- Consumes: Task 1 的内部 Judge 元数据、原始 outcomes 与私有贡献细项。
- Produces: 简写／完整 Judge 配置、独立 score 默认值、严格定义错误。
- 已批准的机械 opt-in：Recall 注册项可选 `assertionScore?: (expect) => { hit?, miss? }`。装配期仅对实际引用同步解析并逐 case 缓存，框架封闭校验、应用独立默认值并以 `pass?hit:miss` 计算贡献；运行和报告阶段不再调用 resolver。未 opt-in 时不读取插件 `input.score`，静态与工厂注册均可使用，resolver 不进入 ScenarioSpec 或报告。

- [x] **Step 1: 写校验与分值失败测试**

覆盖空 score、只写 hit、只写 miss、hit=0、有限正负分值、五项机械的一／两项失败；两个不同输入协议证明 opt-in 通用性，历史 score 非计分字段保持原样，原始 0.4 分数不被改写。覆盖非法 resolver 返回、Promise、额外字段、resolver 抛错，以及 Judge 非法分值、未知字段、空 rubric、点号名、保留键、非法执行参数、重复 YAML key 和旧 case `decision`。

- [x] **Step 2: 运行并记录 RED**

Run: `pnpm exec tsx --test packages/recall/tests/recall-judge-schema.test.ts packages/recall/tests/recall-assertion-scoring.test.ts`
Expected: 新用例按缺失校验或错误计分失败，而非测试语法／夹具错误。

- [x] **Step 3: 实现封闭 Judge schema 与固定默认值**

完整形态只在出现 `rubrics/timeoutMs/maxRetries/instructions` 时启用；rubric 项与 score 对象拒绝未知字段。AI 分值只留在断言侧；机械 expect 原样透传，仅由显式 opt-in resolver 解析，预检后缓存数值配置；历史插件输入字段不由 Recall 抢占。

- [x] **Step 4: 验证 GREEN 和定义错误无资源创建**

Run: `pnpm exec tsx --test packages/recall/tests/recall-judge-schema.test.ts packages/recall/tests/recall-assertion-scoring.test.ts`
Expected: 全部通过；非法定义 CLI=2，主执行与 Judge 调用计数均为 0。

### Task 3: 评测错误与报告分界

**Files:**

- Modify: `packages/recall/src/judge-criterion.ts`、`assertion-results.ts`、`run.ts`
- Test: `packages/recall/tests/recall-judge-errors.test.ts`

**Interfaces:**

- Consumes: 通用 `JudgeOutcome.status/absent` 与 Runner 抛错路径。
- Produces: 内容失败 CLI=0；定义错误 CLI=2；评测错误 CLI=1 且无正常评分结论。

- [x] **Step 1: 写缺失、超时、解析、调用和机械结果畸形测试**

分别固定 fake 响应或 Driver 行为；缺必需裁定、整体调用失败、超时、解析失败和应有判据结果缺失都必须抛出到 Recall failure，不得生成 miss/0 分正常报告。

- [x] **Step 2: 运行并记录 RED**

Run: `pnpm exec tsx --test packages/recall/tests/recall-judge-errors.test.ts`
Expected: 至少缺失裁定或畸形机械结果被现有路径误算／接受，测试按预期失败。

- [x] **Step 3: 实现显式错误与完整性校验**

not-evaluated 保留类别诊断，absent 明确点名；按 spec 的 turn/session expect 逐项核对结果数量、名称、boolean pass、有限 score 和字符串 reason。任何缺失或重复都抛评测错误。

- [x] **Step 4: 运行 GREEN**

Run: `pnpm exec tsx --test packages/recall/tests/recall-judge-errors.test.ts packages/recall/tests/recall-judge-assertion.test.ts`
Expected: 评测错误 CLI=1，内容失败仍 CLI=0，首条总算例不回归。

### Task 4: 同源装配、隔离、取消与清理

**Files:**

- Modify: `packages/recall/src/judge-driver.ts`、`judge-criterion.ts`
- Test: `packages/recall/tests/recall-judge-lifecycle.test.ts`

**Interfaces:**

- Consumes: 同一 `RecallResolvedExecution`、registry、config、transport 与每次 attempt 新 prompt。
- Produces: 独立 backend/Driver、borrowed 空权限 spec、abort 管理和 finally close。

- [x] **Step 1: 写生命周期失败测试**

用手控 gate 覆盖同步／异步 profile、预先 abort、factory 挂起后迟到返回、start/send 期间取消、每次 attempt 新 Driver、close 失败和主 Driver 不共享；记录 spec、effects、executionParams 与调用顺序。

- [x] **Step 2: 运行并记录 RED**

Run: `pnpm exec tsx --test packages/recall/tests/recall-judge-lifecycle.test.ts`
Expected: 异步或迟到 Driver 路径在最小实现上失败；不得用 sleep 猜时序。

- [x] **Step 3: 实现私有 model client 生命周期**

只在实际 attempt 创建资源；取消后不得 start/send；正常、失败和取消路径 finally close；异步工厂迟到返回的 Driver 只 close。direct/borrowed 不 fallback，清理失败显式归类。

- [x] **Step 4: 验证 GREEN 与兼容回归**

Run: `pnpm exec tsx --test packages/recall/tests/recall-judge-lifecycle.test.ts && pnpm --dir packages/recall test && pnpm --dir packages/judge test && pnpm --dir packages/assertions test && pnpm --dir packages/runner test`
Expected: 全部通过，原生 Judge、独立 Assertions 与通用聚合行为不变。

### Task 5: 通用断言职责复用收口

**Files:**

- Create: `packages/assertions/src/judge-results.ts`、`score.ts` 及对应测试
- Modify: `packages/assertions/src/judge-assertion.ts`、`packages/observation/src/criteria-runner.ts` 及测试
- Modify: Recall 的 Judge/score/result 私有接线，删除重复实现

- [x] **Step 1: 先验证通用能力缺失**

Run: `pnpm exec tsx --test packages/assertions/tests/judge-results.test.ts packages/assertions/tests/score.test.ts`；`pnpm exec tsx --test packages/observation/tests/observation-criteria-runner.test.ts`
Expected/Actual: 新导出不存在；runCriteria 对 undefined 结果 Missing expected rejection。

- [x] **Step 2: 实现并由两个使用方复用**

`judgeAssertionResults` 同时服务旧 createJudgeAssertion 与 Recall rubric 展开；`parseAssertionScore/assertionContribution` 服务 AI DSL 与机械 resolver；runCriteria 在结果源校验公共形状。

- [x] **Step 3: 验证职责迁移不改变产品行为**

Run: `pnpm exec tsx --test packages/assertions/tests/judge-results.test.ts packages/assertions/tests/score.test.ts packages/assertions/tests/judge-assertion.test.ts` → 17/17 pass；observation → 6/6 pass；Recall 首条/计分/错误/schema → 11/11 pass。原始 outcomes 与 rawScore=3 不变。

### Task 6: 文档、全量回归与交付审查

**Files:**

- Modify: `docs/spec/recall/recall-judge-dsl.md`、`docs/tutorial/recipes/recall.md`、`packages/recall/README.md`（仅同步已实现行为）
- Modify: 本计划的实际证据记录

- [x] **Step 1: 同步实际行为与验证说明**

把规格状态从“尚未实现”改为实际一期能力；教程给出 fake 可验证配置和报告字段，不声称 live 质量或消费者迁移已验证。

- [x] **Step 2: 运行相关包与全仓收口**

Run: `pnpm check`
Expected: boundary、typecheck、unit test、ittest 全通过；token 测试不进入默认命令。

Run: `pnpm format:check && git diff --check`
Expected: 两个命令均通过；若格式失败，只格式化本轮文件后重跑。

- [x] **Step 3: 自审 diff 并回报主控**

检查领域中立、500 行上限、无后续预设计；公共变化仅限已批准的 Assertions 原语与 Recall registry additive 扩展，contracts/Runner/Judge 公共签名不变，无凭据／live 调用。作者自审曾发现 `__proto__` 内部键被原型吞掉，已补独立 RED→GREEN。汇报修改文件、测试证据、通过／失败／skip、未验证范围、剩余风险和注释收口范围；不提交。

## 真实宿主补充验证

- `E2E_PI_PTY=1 pnpm exec tsx --test examples/tutorial/09-pi-pty.ittest.ts`：真实 Pi 基线 1/1 pass。
- `E2E_PI_RECALL=1 pnpm exec tsx --test examples/tutorial/18-recall-judge-host.ittest.ts`：真实 Pi headless 1/1 pass；两次主单轮请求、一次独立 Judge、rawScore=3、case FAIL/CLI=0、主 read-only/Judge none、两个现场均清理。
- `E2E_PI_RECALL=1 E2E_PI_PTY=1 pnpm ittest`：3/3 pass、0 fail、0 skip，零 token。
- 新用例默认 skip；共享 PTY 对话历史仍未验证。真实 provider/token 已通过下述 Cedar 单轮 smoke。

## itrepo 机械 + AI 同 case live 验证

- 新增 `integrations/itrepos/cedar/judge/.recall.yaml` 与 `scripts/tests/itrepos-judge-config.test.ts`；真实 registry 编译通过。
- `integrations/pi.registry.ts` 新增 session 机械判据 `answer-contract`，通过显式 `assertionScore` 读取自己的 score 配置。
- 首次 `pnpm ittest:token:cedar-judge --carrier pi --approve-live` 暴露 AI forbidden 误判（rawScore=5、case PASS）；将 rubric 改为显式双向判定后重跑。
- 最终 live 结果：机械 answer-contract pass（+1）、AI ready pass（+3）、AI forbidden fail（0），rawScore=4、case FAIL、CLI=0；主输出为 CEDAR_READY/已完成，workspaceCwd 已清理。
- 该 smoke 不证明共享多轮上下文或 Judge 质量。
