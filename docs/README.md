---
title: 文档
type: index
status: active
tags: [documentation]
---

# 文档

x-agent-suite 是一套通用 Agent 测试套件框架：提供 driver、scenario、criterion、report 等基础设施，让不同宿主（CLI、TUI、长驻协议、mock）都能被同一套评估语义驱动。

- 行为、协议、使用和验证变化必须同步本目录。
- 统一术语以根目录 [`CONTEXT.md`](../CONTEXT.md) 为锚；本目录承载详细契约、机制与使用方式。
- 设计/规格文档写入 [`docs/spec/`](./spec/README.md)。
- 未来内容先按职责分层，再按阶段归档：字段、算法与执行契约草案归 [`docs/spec/future/`](./spec/future/README.md)；尚待开展或补证的调研可按需归 `docs/research/future/`。不因“未来”字样混合设计与调研，也不预建空目录。
- 目录层级采用“职责 → 阶段”，不另设 `docs/future/` 总根；如需统一浏览未来事项，通过索引聚合，不为导航重排文档归属。
- 实施计划按记录价值分流：无记录价值的（中间形态、一次性过程稿、与核心业务无关）写入 `.tmp/plans/`（不入库）；有记录价值的写入 `docs/plans/YYYY-MM-DD-<主题>.md`。
- 从模块、工具和组合开始使用见 [`tutorial/`](./tutorial/README.md)。
- 可复用场景仓与真实 Recall 命令见 [`integrations/`](../integrations/README.md)。
- 架构总览见 [`docs/architecture/`](./architecture/README.md)。
- 真实 CLI 适配坑见 [`docs/notes/`](./notes/README.md)。
- 协议调研见 [`docs/research/`](./research/README.md)。

## 快速导航

| 文档                                                                               | 内容                                                         |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [`tutorial/README.md`](./tutorial/README.md)                                       | 可执行教程：模块、工具、组合方式与安全停点                   |
| [`spec/suite-design.md`](./spec/suite-design.md)                                   | 框架总览与三层验证体系                                       |
| [`document-research.md`](./document-research.md)                                   | 重要任务最小检索、future 转正与 Markdown metadata            |
| [`spec/boundary-discipline.md`](./spec/boundary-discipline.md)                     | 边界纪律：四条守卫、三个合法出口、边界债务                   |
| [`spec/layering.md`](./spec/layering.md)                                           | 分层与依赖选型：工具型库 vs 平台                             |
| [`spec/distribution/README.md`](./spec/distribution/README.md)                     | 分发与发布：打包、版本与全局安装                             |
| [`spec/testing.md`](./spec/testing.md)                                             | test / ittest / token ittest 的分层、位置与默认回归规则      |
| [`research/test-file-naming-taxonomy.md`](./research/test-file-naming-taxonomy.md) | 为什么不继续增加 PTY/live/smoke 等测试终止后缀               |
| [`research/agent-messaging-layers.md`](./research/agent-messaging-layers.md)       | Agent 消息通信：传输层与入站触达层的拆分                     |
| [`spec/contracts.md`](./spec/contracts.md)                                         | 核心契约：Observation、Driver、Scenario、Criterion、Registry |
| [`spec/scenario-dsl.md`](./spec/scenario-dsl.md)                                   | Scenario DSL 设计原则：可比性轴、分歧点、LLM 控制器禁区      |
| [`spec/recall/README.md`](./spec/recall/README.md)                                 | Recall 规格索引：考卷、Judge、逐轮断言、变量与组合计分       |
| [`spec/evaluation/README.md`](./spec/evaluation/README.md)                         | 评价与计分：Judge、聚合、访问痕迹与进程证据                  |
| [`spec/target-tags.md`](./spec/target-tags.md)                                     | 四层能力标签、实例与 direct/borrowed/live 决策               |
| [`spec/driver/README.md`](./spec/driver/README.md)                                 | Driver：子进程、长驻会话与 PTY                               |
| [`spec/sandbox.md`](./spec/sandbox.md)                                             | 无 Docker 隔离沙箱                                           |
| [`spec/llm-fixture.md`](./spec/llm-fixture.md)                                     | 自研 fake provider 与 HarnessProfile 配置                    |
| [`spec/ephemeral-client.md`](./spec/ephemeral-client.md)                           | 同级 Carrier 与临时 Client 配置、Adapter 和报告归因          |
| [`spec/future/README.md`](./spec/future/README.md)                                 | 未来与延后设计：有序证据、Recall 分类/分支/停止/组合政策     |
| [`spec/matrix.md`](./spec/matrix.md)                                               | 同场景多宿主对照表                                           |
| [`spec/lessons-from-evals.md`](./spec/lessons-from-evals.md)                       | 从评测实践借鉴的通用模式                                     |
| [`spec/capability-system.md`](./spec/capability-system.md)                         | 能力账本、P0–P8 路线与决策记录                               |
