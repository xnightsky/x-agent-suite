# Headless Profile + Fixture + HarnessDriver

这一条把合成 headless CLI、`HarnessProfile`、`FakeProviderBackend`、sandbox 和 `createHarnessDriver` 全部接通。它证明框架机制；真实宿主仍由消费者注册。

## 运行

```bash
pnpm tutorial:headless
```

源码：[`examples/tutorial/05-headless-fixture.test.ts`](../../../examples/tutorial/05-headless-fixture.test.ts)。示例拉起的是通用 Node 测试 CLI，不是真实宿主，所以仍是 `*.test.ts`。

## 预期结果

摘要应包含：

- `toolCallsCount: 1`，且工具状态由 profile parser 归一为 completed；
- `text: "HEADLESS_DONE"`；
- `backendRequests: 2`，证明工具结果被回喂；
- `cleaned: true`，证明 harness 关闭了 backend 并清理 sandbox。

## 完整链路

```text
FakeProviderBackend.start
  → createSandbox + 注入 baseUrl/apiKey 环境变量
  → HarnessProfile.writeConfig
  → 启动 headless CLI
  → stdout JSONL 经 createParser 变成 ParsedEvent
  → HarnessDriver 聚合 Observation
  → close process/backend/sandbox
```

合成 CLI 会真实请求 loopback fake provider：首轮拿到 `demo_tool`，第二轮回喂 tool result 后拿到 `HEADLESS_DONE`，再把宿主侧事件写成 JSONL。

## 替换成真实宿主

消费者需要替换四处：

1. `profile.command/headlessArgs`：真实 CLI 的启动方式。
2. `writeConfig`：把 server、base URL 与凭据写入该宿主的沙箱配置。
3. `createParser`：把真实宿主 JSONL/流事件归一成 `ParsedEvent`。
4. `serverEntry`：消费者自己的 MCP/server 绝对路径；不得硬编码本机目录。

并删除教程的 `commandOverride`。一旦启动真实宿主 CLI，用例必须移到 `*.ittest.ts` 并由 `pnpm itest` 运行；fixture 仍保持零 token。

## 断言优先级

1. `Observation.toolCalls[].status/input/output`；
2. 消费者 server 或 artifact collector 的客观证据；
3. 文本只作 fuzzy 兜底；
4. 退出码和 stderr 只作诊断，不能单独判成功。

## 风险停点

- 临时 HOME/cwd 不等于禁止公网；真实宿主测试应额外限制权限与出站。
- profile、server 和判据都属于消费者，不能为单一宿主写入 `packages/*/src/`。
- CLI 缺失可以 skip，但正式验收不能把“全部 skip”当作已通过实机验证。
