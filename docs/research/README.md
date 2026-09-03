# 调研笔记

本目录存放与框架设计相关的协议、机制与宿主能力调研。它们帮助消费者理解「为什么 x-agent-suite 这样设计」，但本身不构成框架契约。

## 目录

| 文档                                                           | 内容                                                 |
| -------------------------------------------------------------- | ---------------------------------------------------- |
| [mcp-push-vs-pull.md](./mcp-push-vs-pull.md)                   | MCP 服务端能否主动推送：协议层、传输层、客户端层分析 |
| [agent-messaging-layers.md](./agent-messaging-layers.md)       | Agent 消息通信：传输层与入站触达层的拆分             |
| [test-file-naming-taxonomy.md](./test-file-naming-taxonomy.md) | 测试终止后缀、风险车道与横切标签的取舍               |
