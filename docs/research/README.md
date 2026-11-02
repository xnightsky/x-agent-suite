# 调研笔记

本目录存放与框架设计相关的协议、机制与宿主能力调研。它们帮助消费者理解「为什么 x-agent-suite 这样设计」，但本身不构成框架契约。

## 目录

| 文档                                                                                             | 内容                                                               |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| [mcp-push-vs-pull.md](./mcp-push-vs-pull.md)                                                     | MCP 服务端能否主动推送：协议层、传输层、客户端层分析               |
| [agent-messaging-layers.md](./agent-messaging-layers.md)                                         | Agent 消息通信：传输层与入站触达层的拆分                           |
| [test-file-naming-taxonomy.md](./test-file-naming-taxonomy.md)                                   | 测试终止后缀、风险车道与横切标签的取舍                             |
| [harness-capability-surface.md](./harness-capability-surface.md)                                 | 业界测试框架能力面对标：点收编与面缺口                             |
| [on-demand-install-artifact-matrix.md](./on-demand-install-artifact-matrix.md)                   | 按需安装形态评估：为什么不现在扩展制品矩阵                         |
| [skill-mixed-execution.md](./skill-mixed-execution.md)                                           | 混合执行场景承载力：skill+脚本+CLI / 依赖嵌套 / 安装布局的业界做法 |
| [pi-models-auth-resolution.md](./pi-models-auth-resolution.md)                                   | Pi models/auth 同键关联、凭据优先级与 MCP 显式 auth.provider       |
| [model-graded-assertion-testing.md](./model-graded-assertion-testing.md)                         | AI 断言的确定性接线、真实模型分层与 Judge 质量校准                 |
| [recall-assertion-dsl-design.md](./recall-assertion-dsl-design.md)                               | Recall 断言 DSL 的 KV、直接计分、固定全通过与范围收缩              |
| [recall-classification-branching-pre-design.md](./recall-classification-branching-pre-design.md) | Recall 后续预设计总览与旧链接入口，具体职责已拆分                  |
| [recall-classification-pre-design.md](./recall-classification-pre-design.md)                     | 分类：choices／else、结果协议、错误与验收                          |
| [recall-conditional-branching-pre-design.md](./recall-conditional-branching-pre-design.md)       | 条件分支：内嵌子步骤、自然汇合、结果作用域与路径报告               |
| [recall-turn-assertion-pre-design.md](./recall-turn-assertion-pre-design.md)                     | 轮次级断言：评价时机、结果身份、计分与汇总                         |
| [recall-early-termination-pre-design.md](./recall-early-termination-pre-design.md)               | 提前终止：onFail:stop、停止优先级、报告与清理                      |
| [recall-decision-pre-design.md](./recall-decision-pre-design.md)                                 | 未来 Decision：字段、引用、组合计分、阈值、否决与错误细则          |
