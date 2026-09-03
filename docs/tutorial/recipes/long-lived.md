# LongLivedAgentDriver 多轮与入站教程

这一条演示消费者如何实现长驻 driver：同一会话连续 `inject` 两轮，并等待一条匹配的入站事件。

## 运行

```bash
pnpm tutorial:long-lived
```

源码：[`examples/tutorial/06-long-lived.test.ts`](../../../examples/tutorial/06-long-lived.test.ts)。它是内存实现，属于 `*.test.ts`。

## 预期结果

摘要应为 `turns: 2`、`inboundKind: "notification"`、`injectMode: "followUp"`、`closed: true`。

## 契约中的五件事

1. `injectMode` 在 driver 构造后固定为 `steer` 或 `followUp`，运行中不可切换。
2. `sendPrompt` 可以委托首次 `inject`，保持 `AgentDriver` 兼容。
3. 每次 `inject` 返回当前轮 `Observation`，不能把多轮日志无边界混在一起。
4. `inbound()` 是按序异步流；`waitInbound(match, timeout)` 必须在超时时显式抛错。
5. `close()` 幂等，并结束 event/inbound 流，使消费者不会永久挂起。

教程用 `AsyncQueue` 分别承载 driver events 与 inbound events。第一轮注入后产生 notification，runner 先等待它，再发送 follow-up。

## 替换成消费者实现

- transport reader 负责把外部协议消息压入 inbound queue；
- prompt writer 按固定 `injectMode` 投递；
- 每轮设置明确开始/结束边界和硬超时；
- 把断连、协议错误和超时带上 session/round 上下文；
- close 顺序先终止读写，再关闭进程/连接，最后结束队列。

如果实现会拉起消费者注册的真实宿主 CLI，它属于 `*.ittest.ts`；如果再连接真实 provider，则必须进一步升级为默认 runner 排除的 `*.token.ittest.ts`，文件既可平铺也可按需分组。

## 常见误区

- presence 或 notification 到达不等于模型已消费，二者应使用不同证据。
- 不要用固定 sleep 代替 `waitInbound` 或协议 ack。
- 多个消费者同时消费同一个单消费者队列会分走事件；需要广播语义时由消费者另建 fan-out 层。
