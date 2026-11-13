---
title: Recall 规格
type: index
status: active
tags: [spec, recall]
---

# Recall 规格

本目录集中存放原生 Recall 的现行规格、已确认迁移契约与实施说明。Recall 把声明式考卷编译为 ScenarioSpec 并复用统一 Runner；本目录不改变框架的领域中立边界，具体宿主、判据与场景仍由消费者注册。

## 入口与执行

| 文档                                                             | 内容                                          |
| ---------------------------------------------------------------- | --------------------------------------------- |
| [recall.md](./recall.md)                                         | 考卷发现、严格 YAML、target、编译、执行与 CLI |
| [recall-turn-assertion.md](./recall-turn-assertion.md)           | 线性逐轮评价时机、归因与跨轮计分              |
| [recall-judge-dsl.md](./recall-judge-dsl.md)                     | 内置 Judge、独立裁定会话与 rubric DSL         |
| [recall-runtime-composition.md](./recall-runtime-composition.md) | assertions 原生 client 装配与同源依赖接线方案 |

## 计分与组合

| 文档                                                             | 内容                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------- |
| [recall-scoring.md](./recall-scoring.md)                         | 平铺断言 hit/miss、机械分值接入、rawScore 与报告        |
| [recall-composition-scoring.md](./recall-composition-scoring.md) | allOf/anyOf/firstOf、组合贡献、诊断及 repeat/suite 汇总 |
| [recall-first-of.md](./recall-first-of.md)                       | 旧有序择档的迁移入口与历史验证边界                      |

## 变量与后续设计

- [Recall 变量](./recall-variables.md)：变量、动态 Provider 与两阶段解析。
- [未来与延后设计](../future/README.md)：分类、条件分支、提前停止等仍按阶段集中管理；未转正内容不属于现行行为。

行为或协议变化应原地更新对应规格，并同步 [文档总索引](../../README.md)、[规格总索引](../README.md)、教程和可运行考卷。真实 token 验收要求见 [测试规范](../testing.md)。
