---
title: "Recall 效果评分与通过政策补充调研"
type: research
status: active
tags: [research, recall, scoring, decision]
---

# Recall 效果评分与通过政策补充调研

> 调研日期：2026-11-09。仅使用公开一手资料与本仓文件，不收录仓库外消费者配置或业务内容。逐项可选 `score` 与统一求和方案已定稿并实现，正式契约见 [Recall 断言计分](../spec/recall-scoring.md)；本文保留证据与取舍，不作为待实施设计，不引入 Decision。

## 一、结论

- **多个 rubric 就能分别打分。** 每个 `judge.*` 独立判断效果并配置可选 score，同一评价点仍批量裁定；复合 boolean 不会自动得到部分分。
- **机械也使用可选分值。** 显式 opt-in 的机械判据与 AI 沿用 hit/miss 默认 1/-1；已有 assertionScore 接缝不代表任意机械输入都支持 score。
- **本次不引入 Decision。** 各项贡献直接求和即可；分数是否驱动最终通过是另一项需求，不能从差异评分推导出来。
- **分类不等于评级。** 无顺序的路由类别不自动赋分；不可自然拆解的完成度，才考虑有限等级加确定性分值映射。
- **不让模型自由报分，不把评测错误算成低分。** 可解析、可追溯不等于判断准确，仍须人工校准。
- **只需比较效果时不必改变 PASS。** 分数与逐项失败已能用于诊断，新增验收政策必须有独立需求。

## 二、本仓事实

| 证据                                                        | 已确认事实                                                        |
| ----------------------------------------------------------- | ----------------------------------------------------------------- |
| [Recall 断言计分](../spec/recall-scoring.md)                | 默认贡献 1/-1；当前全部断言通过才通过，正分不能补偿失败。         |
| `packages/recall/src/assertion-results.ts:112–130`          | 报告投影求 rawScore，不用分数重算 hardPass。                      |
| `packages/runner/src/run-scenario.ts:216–225`               | 通用 runner 有 aggregate 接缝，但不代表 Recall DSL 已开放该政策。 |
| `packages/assertions/src/evidence/index.ts:223–271`         | allOf 保留子项原因，整体仍只产生一个 pass 和 0/1 标准分。         |
| `packages/recall/tests/recall-turn-assertion.test.ts:84–87` | 已执行零 token 回归，覆盖 rawScore=6、hardPass=false。            |
| [一期 DSL 调研](./recall-assertion-dsl-design.md)           | 维度表、重复赋分与引用维护成本，是此前收缩接口的原因。            |

过程事实应交给机械证据；只看回答文本的 Judge 不能证明工具操作真实发生。[通用聚合契约](../spec/scoring-aggregation.md) 的 weight、归一分和缺席映射也不等于 Recall 的 hit/miss 求和，不应为复用而混淆。

## 三、补充核验的一手实践

### promptfoo：显式通过政策

官方文档支持 weight 加权平均、测试级和 assert-set 通过线；测试级 threshold 可以覆盖个体 verdict，未配置时要求非零权重断言全部通过。[S1]

llm-rubric 可以让模型返回 pass、score、reason。存在显式 pass 且配置 threshold 时，两者都须满足；省略 pass 和 threshold 时，正的部分分可能被当成通过，文档专门警告这种误配置。[S2]

**取舍：**通过线是额外的验收政策，不是差异评分的前提；本次不引入它，也不复制加权平均、模型整体放行或 weight=0 隐式改变断言状态的做法。hit/miss 已有分值，不再叠加 weight。

### Inspect AI：有限等级承载部分分

model_graded_qa 默认裁定 C/I，partial_credit=True 可增加 P；默认指标将部分分映射为 0.5。[S3] 源码 value_to_float 将 C/P/I/N 默认映射为 1/0.5/0/0；默认指令约束已提供的等级集合，自定义指令或 grade_pattern 另有行为。[S4][S5]

**取舍：**借鉴“模型选等级、代码映射分值”，不照搬默认 0.5 或内建领域等级。合理拒绝、必要澄清不天然是低分，成功定义归消费者。

### OpenAI Evals：选择与赋分分离

开源模板通过 choice_strings 约束选择，choice_scores 静态映射分数；集合外输出解析为 `__invalid__`。[S6]

**取舍：**有限评级可只让模型返回等级键和理由，分值映射由代码执行；合法最低档与非法输出必须区分。普通分类不因此自动升级为评分项。

### Judge 质量不能由接线正确证明

OpenAI 评估指南建议采用分类、成对比较或明确标准评分，并用人工反馈校准。[S7] 这支持受约束接口，但不能证明多档比 boolean 更准确。

OpenAI [Graders 指南](https://platform.openai.com/docs/guides/graders) 也支持部分分，但访问时已有弃用提示，且 score_model 对非数值输出默认给 0。本仓不建议增加该供应商依赖，也不沿用错误归零策略。

## 四、方案取舍与收口

| 方案                               | 取舍                                                       |
| ---------------------------------- | ---------------------------------------------------------- |
| 只拆效果、改善报告                 | 无须改通过契约，优先试用；不能允许部分失败仍验收。         |
| 恢复旧 Decision 的维度表与独立赋分 | 表达力更大，但重复维护、筛选计分项和两套成绩目前没有必要。 |
| 原断言总分加通过线、必须项         | 仅在另有“按分数放行”的明确需求时考虑，不属于本次评分方案。 |
| 模型直接报连续分                   | 接口看似短，但尺度锚点和审计性不足，不优先采用。           |
| 有限等级加静态映射                 | 仅在独立效果不足以表达差异时另议，需要协议和质量证据。     |

现行方案采用独立效果计分与统一求和，正式规格已迁出 future。先前把差异评分推进成 Decision 设计扩大了需求，已撤回字段、算法与算例；[后续设计说明](../spec/recall-judge-dsl.md#decision-分数验收政策) 只记录未来分数放行的独立触发条件。机械自定义分值仍经显式 resolver 接入，不为旧输入强加包装，也不把 score 误称为 scope。

[分类专题](../spec/future/recall-classification-pre-design.md#8-分类与评级) 继续不自动赋分；评级尚无 DSL，不属于本次已定稿的逐项计分能力。

## 五、使用与质量验证边界

框架计分机制已实现，以下消费者接入与质量验证不是其转正前置条件。使用时应以授权或合成的固定输出验证独立效果是否有区分度，并逐项确认所用机械判据是否接入可选分值；未接入时不能宣称配置生效。只有另有分数放行需求才重新讨论验收政策，外部框架先例不代替该扩展的第二消费者论证。

真实 Judge 另用人工标签、开发集与保留集校准，分别测误放行/误拒绝和重测翻转；Agent 输出方差与裁判方差分开。不同评分版本的原始分数不直接横比。详细方法沿用 [Judge 质量分层调研](./model-graded-assertion-testing.md)，不另建质量协议。

已核验一手文档/源码和本仓语义，并通过 21 项零 token 定向测试，覆盖通用分值、机械 resolver、Judge schema、case 级 CLI 计分与逐轮断言接线。未运行全量回归，未验证真实 Judge 准确率、作者体验、具体消费者插件接入及分数放行的第二消费者适用性。无真实 provider 调用，不将文档算例或 fake 接线测试当作模型质量验证。

## 六、来源

以下为本轮实际访问的一手材料；网页和 main 分支为访问时内容，未固定到发布版本。

- **[S1]** promptfoo，Assertions & metrics：<https://www.promptfoo.dev/docs/configuration/expected-outputs/>
- **[S2]** promptfoo，LLM Rubric：<https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/llm-rubric/>
- **[S3]** Inspect AI，Model Grading：<https://inspect.aisi.org.uk/model-graded.html>
- **[S4]** Inspect AI，_metric.py：<https://github.com/UKGovernmentBEIS/inspect_ai/blob/main/src/inspect_ai/scorer/_metric.py>
- **[S5]** Inspect AI，_model.py：<https://github.com/UKGovernmentBEIS/inspect_ai/blob/main/src/inspect_ai/scorer/_model.py>
- **[S6]** OpenAI Evals，Eval templates：<https://github.com/openai/evals/blob/main/docs/eval-templates.md>
- **[S7]** OpenAI，Evaluation best practices：<https://developers.openai.com/api/docs/guides/evaluation-best-practices>
