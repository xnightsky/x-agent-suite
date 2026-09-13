# Pi PTY driver → runScenarioSpec（真实宿主）

这一条是 [harness-runner](./harness-runner.md) 的真实宿主版：同一套 ScenarioSpec 与判据，
driver 槽位从合成 headless 换成真实 Pi TUI（PTY），模型请求只连本机假端点，零 token。

## 运行

```bash
E2E_PI_PTY=1 pnpm tutorial:runner:pi
```

源码：[`examples/tutorial/15-pi-pty-runner.ittest.ts`](../../../examples/tutorial/15-pi-pty-runner.ittest.ts)。
拉起真实宿主 CLI，归集成测试层（`pnpm ittest` 默认收口，缺前置显式 skip）。

## 预期结果

- 未设 `E2E_PI_PTY=1`：显式 skip，不失败；
- 设门后：真实 Pi TUI 经 `runScenarioSpec` 完成一轮，`hardPass: true`，
  `backendRequests: 1`（证明模型请求只打假端点）。

## 代码怎么流动

1. `createPtyAgentDriver`（`piProfile` + `FakeProviderBackend` + `injectServer: false`）
   满足 runner 的 `AgentDriver` 契约——与首个 runner 消费者的双 PTY 复合 driver 同一条缝；
2. runner 的三级超时（轮 > 场景 > 默认）叠在 PTY 自身的 ready/prompt 超时之上，
   本例显式给场景 `timeoutMs: 60_000`；
3. PTY 面 `Observation.toolCalls` 恒空：本例只用 `text-contains` 判据，
   工具调用断言的做法见 [pty](./pty.md) 的证据边界。

## 常见误区

- 不要把 PTY 时序敏感场景塞进过短的轮超时——TUI 启动与渲染比 headless 慢一个量级；
- 门控变量 `E2E_PI_PTY` 与 09-pi-pty 共用：一个旗标开启同一风险类的全部真实 Pi 用例。
