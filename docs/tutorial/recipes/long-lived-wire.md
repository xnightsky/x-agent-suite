# JSON-RPC 长驻 wire 层教程

这一条演示框架内建的长驻 JSON-RPC wire 基座：`LongLivedJsonRpcDriver` 组合 `JsonlProcess` + `JsonRpcPeer`，拉起一个脚本化假 peer 子进程，在同一会话完成两轮 `inject` 并等待一条轮次外入站事件。协议专有语义（握手序列、prompt 报文、通知归一）全部落在消费者注入的 adapter 里——框架不认识任何具体协议。

## 运行

```bash
pnpm tutorial:long-lived-wire
```

源码：[`examples/tutorial/06-long-lived-wire.test.ts`](../../../examples/tutorial/06-long-lived-wire.test.ts)；假 peer 行为脚本：[`examples/tutorial/fake-wire-behavior.ts`](../../../examples/tutorial/fake-wire-behavior.ts)。假 peer 是通用测试子进程、零 token、不起真实宿主，属于 `*.test.ts`。

## 预期结果

摘要应为 `recipe: "long-lived-wire"`、`turns: 2`、`firstText: "echo:first turn"`、`secondText: "echo:second turn"`、`inboundKind: "notification"`、`injectMode: "followUp"`、`closed: true`。

## 三个组件各管一件事

1. `JsonRpcPeer`（协议无关 wire 层）：请求 id 配对与超时、消费循环三态路由（响应 / 反向请求 / 通知）、未注册反向请求回 `-32601`、反向请求 handler 抛错回 `-32603` 并带原因、流断且有悬挂请求时显式拒绝（无悬挂请求的自然流结束属正常结束）、幂等 close。
2. `LongLivedJsonRpcDriver`（LongLivedAgentDriver 骨架）：轮次串行化、轮次内通知聚合进当轮 `Observation`、轮次外通知进 `inbound()`、`waitInbound` 超时显式抛错、close 前 best-effort 告别请求。
3. `JsonRpcLongLivedAdapter`（消费者接缝）：`handshake`（握手与会话句柄提取）、`buildPrompt`（构造一轮 prompt 报文）、`answerReverseRequest`（可选，应答反向请求）、`mapNotification`（通知归一为当轮 / 入站 / 忽略）、`closeRequest`（可选，告别请求）。

教程里的 adapter 使用虚构方法名（`handshake` / `turn` / `event` / `finish`）。真实消费者（如 ACP over stdio 的长驻通道）只需替换 adapter 与 spawn 描述，wire 层与轮次编排保持不变。

## 替换成消费者实现

- `handshake` 内部通过 `peer.request(method, params, timeoutMs)` 完成初始化序列，返回值作为会话句柄回传；
- `mapNotification` 返回 `{ kind: "round", eventType, text?, toolCall? }` 归当轮聚合；返回 `{ kind: "inbound", event }` 转入站；`{ kind: "ignore" }` 丢弃；
- adapter 实例可持有跨调用状态（如工具调用合并器），`buildPrompt` 每轮调用一次，可作为轮次边界重置时机；
- 需要应答对端反向请求（如审批类交互）时实现 `answerReverseRequest`，返回 `{ handled: false }` 由 wire 层回 `-32601`。

如果 spawn 拉起的是消费者注册的真实宿主 CLI，测试文件应升级为 `*.ittest.ts`；再连接真实 provider 则升级为 `*.token.ittest.ts`。

## 常见误区

- 不要把协议方法名写进框架层；方法名只出现在消费者 adapter 与测试脚本里。
- 不要在 `mapNotification` 里吞错；adapter 抛错会使 wire 显式失败，而不是静默丢通知。
- 轮次外被映射为 `round` 的通知会显式抛错——归一逻辑必须自己区分轮次内外（如按通知内容判定）。这是刻意设计而非遗漏：静默归类会让轮次边界漂移且不可诊断。
- 同理，`answerReverseRequest` 抛错时 wire 层回 `-32603` 而非吞掉：对端必须拿到显式错误，否则它会把反向请求挂起到超时。
