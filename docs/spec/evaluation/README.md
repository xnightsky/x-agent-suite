---
title: 评价与计分规格
type: index
status: active
tags: [spec, evaluation, scoring, evidence]
---

# 评价与计分规格

本目录集中存放跨宿主、跨考卷的评价与计分基础设施。具体判据、rubric 和业务语义仍由消费者注册，框架不在此内建被测系统知识。

| 文档 | 内容 |
| --- | --- |
| [judge.md](./judge.md) | 通用 AI Judge、批量 rubric、具名 verdict 与裁定会话 |
| [scenario-evaluation.md](./scenario-evaluation.md) | Scenario 评价层、结果与报告 |
| [scoring-aggregation.md](./scoring-aggregation.md) | 通用维度聚合、knockout/absent 与 coverage |
| [evidence-assertions.md](./evidence-assertions.md) | 访问痕迹证据及布尔组合 |
| [process-execution-evidence.md](./process-execution-evidence.md) | 进程执行证据的待审设计与接入边界 |

Recall 专属 DSL 与组合计分见 [Recall 规格](../recall/README.md)；延后设计仍统一归 [future](../future/README.md)。
