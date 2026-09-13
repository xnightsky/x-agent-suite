# HarnessDriver → runScenarioSpec 主链

这一条演示 P7 的核心接线：把 `createHarnessDriver` 产出的 harness driver 直接交给
runner——合成 headless profile + loopback 假端点，零 token，归单元测试层。

## 运行

```bash
pnpm tutorial:harness-runner
```

源码：[`examples/tutorial/14-harness-runner.test.ts`](../../../examples/tutorial/14-harness-runner.test.ts)。

## 预期结果

`TUTORIAL_SUMMARY` 应包含：`hardPass: true`、`score: 1`、
`coverage: { evaluated: 2, total: 3 }`、`states: ["hit", "hit", "absent"]`——
`text-contains` 与 `tool-call` 命中，style 维度缺席计入分母。

## 代码怎么流动

1. 合成 `HarnessProfile`（通用 Node 子进程扮演宿主，与 05-headless-fixture 同款形态）；
2. `createDriver` 工厂每次调用新建 `FakeProviderBackend` + `createHarnessDriver`
   ——runner 只认 `AgentDriver` 契约，不认识 harness；
3. `runScenarioSpec` 逐轮 `sendPrompt`：`Observation.toolCalls` 由 harness parser
   从 JSONL 事件归一（对比 PTY 面恒空，见 [pty](./pty.md) 的证据边界）；
4. 判据调度 + 聚合出口分，`hardPass = aggregate.pass`。

## 换成消费者实现

- profile 换成消费者的真实宿主 profile，`commandOverride` 去掉即可；
- backend 换 live 渠道时整个组合自动落入 token 层（姿态轴规则）；
- 复合 driver（多 PTY 会话）同样满足本接线——首个 runner 消费者已验证。

## 常见误区

- `createDriver` 必须**每次新建 backend**：`FakeProviderBackend` 的 script 是有状态的，
  多场景共享会串台；
- 不要在 runner 场景里手工 `driver.start()`——生命周期归 runner（start → 逐轮 → finally close）。
