---
title: Driver 规格
type: index
status: active
tags: [spec, driver]
---

# Driver 规格

本目录集中存放 AgentDriver 契约与具体驱动机制。Driver 负责把宿主执行归一为 Observation，不负责领域判定或 live target 选择。

| 文档                                           | 内容                                  |
| ---------------------------------------------- | ------------------------------------- |
| [driver.md](./driver.md)                       | 子进程、JSONL、PTY 基座与宿主适配纪律 |
| [long-lived-driver.md](./long-lived-driver.md) | 长驻会话驱动契约                      |
| [pty-driver.md](./pty-driver.md)               | PTY 驱动、屏幕缓冲与 idle 判定        |

场景编排见 [Scenario Runner](../scenario-runner.md)，隔离机制见 [Sandbox](../sandbox.md)，Recall 执行入口见 [Recall 规格](../recall/README.md)。
