---
title: 未来与延后设计
type: index
status: active
tags: [future, pre-design]
---

# 未来与延后设计

本目录集中保存明确延后、未来候选或不进入当前实施范围的设计。**归档不等于批准实现，也不代表现有公开契约。**

评分正式规格已迁至 [Recall 断言计分](../recall/recall-scoring.md)，不再作为 future 独立文档保留。Decision 分数放行仍未批准，延后边界见 [Judge DSL 后续设计](../recall/recall-judge-dsl.md#decision-分数验收政策)。

## 收录边界

- 整份设计文档明确标为未来、延后或不进入当前阶段时，放在本目录；状态、启用条件和未验证范围应写清楚。以字段、算法或执行契约草案为主要产出的 Recall 预设计属于此类。
- 仅标为“待审／未实现”不自动归入；当前阶段拟推进的设计仍留在 `docs/spec/`。
- 已实现机制、包含当前能力的路线账本和纯外部资料调研不整体迁入；尚待开展或补证的调研可按需归 `docs/research/future/`，已完成调研仍留在 research。当前规格只保留必要的后续入口，独立延后设计在这里展开。
- 重新启用前先确认需求、边界冲突与验收证据，再更新状态及实施范围；不得因已有草案提前增加运行时 API、schema 占位或默认测试。

## 目录

| 文档                                                            | 范围                                        | 重新审查的需求                                 |
| --------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------- |
| [Evidence 有序调用与局部捕获](./evidence-sequence.md)           | sequence、局部 steps、可信 seq 与严格时序   | 实际调用顺序或前序返回值消费不能由独立证据满足 |
| [Recall 分类](./recall-classification-pre-design.md)            | choices／else、不自动计分；区分独立评级候选 | boolean 判断不能表达需要记录的有限类别         |
| [Recall 条件分支](./recall-conditional-branching-pre-design.md) | 条件树、内嵌子步骤与自然汇合                | 有明确条件执行需求，并先解决可比性原则冲突     |
| [Recall 提前终止](./recall-early-termination-pre-design.md)     | onFail:stop、报告与清理                     | 明确失败后继续执行的成本或风险不可接受         |

## 未决边界与验证

- 条件分支的可比性主张与现行 [Scenario DSL](../scenario-dsl.md#可比性轴) 的主动分支禁令仍有冲突；实施前须先裁决适用边界并更新规格。
- sequence 的 collector 到达序号不等于实际执行顺序；可信严格时序的同步前提与重启门槛见对应专题。
- 文档中的 YAML、类型、算例及验收清单均为候选，不是已可运行的功能或已经通过的宿主验证。当前 Recall 行为仍以各现行规格及实现为准。
