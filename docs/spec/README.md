---
title: 设计规格
type: index
status: active
tags: [spec]
---

# 设计规格

本目录记录 x-agent-suite 的设计原则、契约语义与运行机制。

明确延后、不进入当前阶段的方案集中在 [`future/`](./future/README.md)。仅标记待审的当前候选仍留在本目录；归入 future 不等于批准实现。

## 目录

| 文档                                                             | 内容                                                                  |
| ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| [suite-design.md](./suite-design.md)                             | 框架总览：验证层、运行模式、环境变量                                  |
| [capability-system.md](./capability-system.md)                   | 能力体系：能力账本（内核/子包/不做）、五问需求侧、P0–P8 路线          |
| [boundary-discipline.md](./boundary-discipline.md)               | 边界纪律：四条守卫、三个合法出口、边界债务                            |
| [layering.md](./layering.md)                                     | 分层与依赖选型：工具型库 vs 平台                                      |
| [contracts.md](./contracts.md)                                   | 通用类型契约：Observation、Driver、Scenario、Criterion、Registry      |
| [scenario-dsl.md](./scenario-dsl.md)                             | Scenario DSL 设计原则：可比性轴、分歧点、LLM 控制器禁区               |
| [scenario-runner.md](./scenario-runner.md)                       | P3 设计：Registry 运行时、DSL 执行与 CLI                              |
| [recall/README.md](./recall/README.md)                           | Recall 规格索引：考卷、Judge、逐轮断言、变量、组合计分与迁移        |
| [evaluation/README.md](./evaluation/README.md)                 | 评价与计分：Judge、Scenario 评价、聚合、访问痕迹与进程证据        |
| [target-tags.md](./target-tags.md)                               | 四层能力标签、实例与 direct/borrowed/live 决策                        |
| [driver/README.md](./driver/README.md)                             | Driver：子进程/JSONL/PTY 基座、长驻会话与 PTY 驱动                |
| [sandbox.md](./sandbox.md)                                       | 临时 `HOME` / `cwd`、环境剥离、并发隔离与清理                         |
| [llm-fixture.md](./llm-fixture.md)                               | `LlmBackend`、自研 fake provider、`HarnessProfile` 配置               |
| [ephemeral-client.md](./ephemeral-client.md)                     | 同级 Carrier kind、Client Adapter 引用与渠道复用                      |
| [host-config-projection.md](./host-config-projection.md)         | 渠道与执行偏好分离、单次参数、Pi 消费者隔离投影与保真边界             |
| [live-auth-config.md](./live-auth-config.md)                     | 可选 `.env.auth.yaml`：provider 凭据、来源优先级与失败语义            |
| [distribution/README.md](./distribution/README.md)               | 分发与发布：打包、版本、全局安装与制品边界                        |
| [future/README.md](./future/README.md)                           | 未来与延后设计：有序证据、Recall 分类/分支/停止/组合政策              |
| [matrix.md](./matrix.md)                                         | `runMatrix`：变体串行、carrier 并行、对照表与报告                     |
| [lessons-from-evals.md](./lessons-from-evals.md)                 | 从内部评测实践总结的通用模式                                          |
