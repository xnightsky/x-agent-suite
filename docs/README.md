# 文档

x-agent-suite 是一套通用 Agent 测试套件框架：提供 driver、scenario、criterion、report 等基础设施，让不同宿主（CLI、TUI、长驻协议、mock）都能被同一套评估语义驱动。

- 行为、协议、使用和验证变化必须同步本目录。
- 设计/规格文档写入 [`docs/spec/`](./spec/README.md)。
- 从模块、工具和组合开始使用见 [`tutorial/`](./tutorial/README.md)。
- 架构总览见 [`docs/architecture/`](./architecture/README.md)。
- 真实 CLI 适配坑见 [`docs/notes/`](./notes/README.md)。
- 协议调研见 [`docs/research/`](./research/README.md)。

## 快速导航

| 文档                                                                               | 内容                                                         |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [`tutorial/README.md`](./tutorial/README.md)                                       | 可执行教程：模块、工具、组合方式与安全停点                   |
| [`spec/suite-design.md`](./spec/suite-design.md)                                   | 框架总览与三层验证体系                                       |
| [`spec/boundary-discipline.md`](./spec/boundary-discipline.md)                     | 边界纪律：四条守卫、三个合法出口、边界债务                   |
| [`spec/layering.md`](./spec/layering.md)                                           | 分层与依赖选型：工具型库 vs 平台                             |
| [`spec/packaging.md`](./spec/packaging.md)                                         | 包分发、安装方式、版本管理与原生依赖分层                     |
| [`spec/testing.md`](./spec/testing.md)                                             | test / itest / token itest 的分层、位置与默认回归规则        |
| [`research/test-file-naming-taxonomy.md`](./research/test-file-naming-taxonomy.md) | 为什么不继续增加 PTY/live/smoke 等测试终止后缀               |
| [`research/agent-messaging-layers.md`](./research/agent-messaging-layers.md)       | Agent 消息通信：传输层与入站触达层的拆分                     |
| [`spec/contracts.md`](./spec/contracts.md)                                         | 核心契约：Observation、Driver、Scenario、Criterion、Registry |
| [`spec/scenario-dsl.md`](./spec/scenario-dsl.md)                                   | Scenario DSL 设计原则：可比性轴、分歧点、LLM 控制器禁区      |
| [`spec/driver.md`](./spec/driver.md)                                               | 子进程 / JSONL / PTY 基座                                    |
| [`spec/sandbox.md`](./spec/sandbox.md)                                             | 无 Docker 隔离沙箱                                           |
| [`spec/llm-fixture.md`](./spec/llm-fixture.md)                                     | 自研 fake provider 与 HarnessProfile 配置                    |
| [`spec/scenario-evaluation.md`](./spec/scenario-evaluation.md)                     | 评分层与报告格式                                             |
| [`spec/matrix.md`](./spec/matrix.md)                                               | 同场景多宿主对照表                                           |
| [`spec/long-lived-driver.md`](./spec/long-lived-driver.md)                         | 长驻会话驱动契约                                             |
| [`spec/pty-driver.md`](./spec/pty-driver.md)                                       | PTY 驱动层                                                   |
| [`spec/lessons-from-evals.md`](./spec/lessons-from-evals.md)                       | 从评测实践借鉴的通用模式                                     |
| [`spec/roadmap.md`](./spec/roadmap.md)                                             | 后续演进路线                                                 |
