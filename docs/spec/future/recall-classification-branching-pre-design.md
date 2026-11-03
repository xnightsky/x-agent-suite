---
title: Recall 后续能力预设计索引
type: pre-design
status: future
tags: [recall, pre-design]
---

# Recall 后续能力预设计索引

> 状态：后续预设计索引，不是已实现契约，不进入一期实施范围。
>
> 原文同时讨论分类、分支、逐轮断言和提前停止，现已按职责拆分。线性轮次断言已转为 [现行规格](../recall-turn-assertion.md)，本文只为其余 future 专题保留组合导航，不重复定义字段与算法。
>
> 一期以 [内置 Judge 与断言计分 DSL](../recall-judge-dsl.md) 为准；score 可省略，默认 `{hit: 1, miss: -1}`，机械与 boolean AI 判断相同。

## 统一命名与职责

本目录独立预设计文档统一使用 `recall-<主题>-pre-design.md`：

| 文档                                                                  | 只回答的问题                         | 核心作者字段                                |
| --------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------- |
| [Recall 分类预设计](./recall-classification-pre-design.md)            | 当前输出属于哪个已声明类别？         | judge 项内的 choices／else。                |
| [Recall 条件分支预设计](./recall-conditional-branching-pre-design.md) | 读取已有结果后，执行哪组子步骤？     | branch.cases／when／turns／else。           |
| [Recall 提前终止预设计](./recall-early-termination-pre-design.md)     | 哪种明确失败应停止剩余轮次？         | onFail:stop。                               |
| [Recall Decision 预设计](./recall-decision-pre-design.md)             | 如何对已产生的判断执行组合通过政策？ | decision.dimensions、threshold 等未来草案。 |

每份文档分别包含作者形状、字段与校验、执行或计算顺序、错误、报告及验收。它们不是一个必须同时上线的大功能。

## 组合关系

```text
轮次级断言：决定本轮何时产生判断与分类
分类：产出有限 choice，不直接计分或选择子步骤
提前终止：明确失败且配置 onFail:stop 时先停止
条件分支：否则执行所选内嵌子序列，结束后自然继续外层
Decision：只在已产生结果上执行未来组合评分政策
```

分类不依赖条件分支；逐轮断言不依赖提前停止；前三类控制能力都不要求先实现 Decision。

## 共同约束

- score 可选，默认 hit=1／miss=-1；分类 choice 本身不是 boolean，不自动计分。
- 明确未通过按 miss 计分；结果缺失、无效或调用失败报评测错误，不恢复缺席映射。
- 合法未走分支或提前停止后的轮次标记未执行，不伪造判断或分数。
- 规则一致不要求轨迹相同。重要分支通过多个 case 覆盖，模型方差通过 repeat 观察，不自动穷举。
- 模型只在受约束结果集合内裁定；分支和停止由作者规则决定，不能让模型自由生成下一步。
- 不暴露 nodes／edges、通用脚本或嵌套表达式语言。
- 各文档推荐字段与报告形状仍需正式规格确认；不代表现有 API，也不授权修改源码。

## 沿用的调研来源

以下为原文已记录的一手资料，本轮拆分没有重新验证外部实现：

1. OpenAI Evals，Eval templates：<https://github.com/openai/evals/blob/main/docs/eval-templates.md>
2. promptfoo，Classifier grading：<https://www.promptfoo.dev/docs/configuration/expected-outputs/classifier/>
3. OpenAI Agents SDK，Agent orchestration：<https://openai.github.io/openai-agents-python/multi_agent/>
4. LangGraph，Graph API：<https://docs.langchain.com/oss/python/langgraph/graph-api>
5. Inspect AI，Solvers／Early Termination：<https://inspect.aisi.org.uk/solvers.html#early-termination>

外部能力证明这些方向有先例，不代表一期必须采用相同字段或完整工作流框架。分类质量、复杂路径、逐轮成本与宿主提前停止行为均未实测。
