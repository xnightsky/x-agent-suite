# Fake Provider 工具轮教程

这一条只验证模型 wire：本机 loopback 假端点按脚本先返回工具调用，再在收到 tool result 后返回最终文本。

## 运行

```bash
pnpm tutorial:fixture
```

源码：[`examples/tutorial/03-fixture-backend.test.ts`](../../../examples/tutorial/03-fixture-backend.test.ts)。它使用 `FakeProviderBackend`，不连接真实 provider，因此是 `*.test.ts`。

## 预期结果

摘要应显示 `toolCallSeen: true`、`finalTextSeen: true`、`requestCount: 2`；请求副本写入临时输出目录的 `requests.jsonl`。

## 两轮是怎样判定的

```text
第 1 个请求：只有 user message
  → fixture script[0] 返回 demo_tool({id:"42"})

第 2 个请求：历史中包含 role=tool
  → fixture script[1] 返回 FINISHED
```

`FakeProviderBackend` 不是靠全局请求计数取轮次，而是按请求体中的 tool result 数量选脚本项；这让重试、并发隔离和诊断更可靠。

## 换成消费者实现

- `wire` 必须与消费者 `HarnessProfile.wire` 一致。
- fixture 工具名必须使用 profile 的 `toolName`/`toolNamespace` 规则拼接。
- fixture 参数应是 scenario 的确定性输入，不要让测试脚本自己做领域判断。
- 需要诊断宿主实际请求时设置 `dumpPath`，但产物必须写入 `.tmp/` 或测试临时目录。

下一步是把这个 backend 与 profile、sandbox、driver 接起来，见[headless fixture 教程](./headless-fixture.md)。

## 常见误区

- loopback 降低 token 与账号风险，不等同于完整网络沙箱。
- “收到两次请求”不等于工具成功；真实 harness 测试仍要断言归一后的 `ToolCall.status`。
- fixture 脚本耗尽会显式返回错误，不应在测试中静默追加万能 fallback。
