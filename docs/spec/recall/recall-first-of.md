---
title: Recall 有序择档断言迁移说明
type: spec
status: active
tags: [recall, assertions, first-of, scoring]
---

# Recall 有序择档断言迁移说明

> 本文不再单独定义计分规则。三种组合的现行设计已统一收口到 [Recall 组合断言与计分](./recall-composition-scoring.md)，避免 firstOf 与 allOf/anyOf 出现两套分值来源或错误语义。

## 迁移结论

组合扩展已将 firstOf 从“接受首个原始 pass 档”迁移为“接受首个实际贡献大于 0 的档”，并补齐 allOf、anyOf、repeat/suite 统计。主要影响：

- hit=0 或负 hit 的原始通过档不再抢占，继续执行后档；
- 分支省略 score 且内部有多个条件时，采用内部实际贡献之和，不再固定为 +1/-1；
- 执行、裁定和清理错误仍为 ERROR，不触发降级，不被其他分支结果吞掉；
- 合法 skipped 不记失败、不计贡献、不进入相应覆盖率分母。

完整 DSL、分值唯一来源、共同 miss、算例、报告字段和验收标准见 [组合断言与计分](./recall-composition-scoring.md)。普通平铺断言的 hit/miss 与 rawScore 规则仍见 [Recall 断言计分](./recall-scoring.md)。

## 历史验证边界

旧 firstOf 的运行时与真实验证记录仅证明迁移前行为，不能作为新组合或新 firstOf 语义的验收证据。历史回执保留在 [first-of 场景](../../../integrations/itrepos/recall-scoring/first-of/README.md#本次真实验收回执)；其中已知的 Judge 误判仍按原记录保留，不因文档迁移改写。

新行为的组合原语、Recall DSL、诊断、repeat/suite 汇总和默认零 token 回归已交付，完整 `pnpm check` 已通过；可运行考卷见 [composition 场景](../../../integrations/itrepos/recall-scoring/composition/README.md)。真实 token 验收仍未获授权，状态为“实现完成，真实验收待完成”。
