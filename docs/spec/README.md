# 设计规格

本目录记录 x-agent-suite 的设计原则、契约语义与运行机制。

## 目录

| 文档                                               | 内容                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------- |
| [suite-design.md](./suite-design.md)               | 框架总览：验证层、运行模式、环境变量                                  |
| [boundary-discipline.md](./boundary-discipline.md) | 边界纪律：四条守卫、三个合法出口、边界债务                            |
| [layering.md](./layering.md)                       | 分层与依赖选型：工具型库 vs 平台                                      |
| [contracts.md](./contracts.md)                     | 通用类型契约：Observation、Driver、Scenario、Criterion、Registry      |
| [scenario-dsl.md](./scenario-dsl.md)               | Scenario DSL 设计原则：可比性轴、分歧点、LLM 控制器禁区               |
| [driver.md](./driver.md)                           | 子进程基座：`JsonlProcess`、`PtyProcess`、严格 LF 分帧 + 宿主适配纪律 |
| [sandbox.md](./sandbox.md)                         | 临时 `HOME` / `cwd`、环境剥离、并发隔离与清理                         |
| [llm-fixture.md](./llm-fixture.md)                 | `LlmBackend`、自研 fake provider、`HarnessProfile` 配置               |
| [packaging.md](./packaging.md)                     | 包分发、安装方式、版本管理与原生依赖分层                              |
| [scenario-evaluation.md](./scenario-evaluation.md) | 评分层：Dry / Hard / Fuzzy / enumerate / 报告                         |
| [matrix.md](./matrix.md)                           | `runMatrix`：变体串行、carrier 并行、对照表与报告                     |
| [long-lived-driver.md](./long-lived-driver.md)     | `LongLivedAgentDriver` 与入站事件观测                                 |
| [pty-driver.md](./pty-driver.md)                   | PTY 驱动层：屏幕 idle 判定与 TUI 门槛                                 |
| [lessons-from-evals.md](./lessons-from-evals.md)   | 从内部评测实践总结的通用模式                                          |
| [roadmap.md](./roadmap.md)                         | 演进路线与未决事项                                                    |
