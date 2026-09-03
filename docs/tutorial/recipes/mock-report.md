# Mock → Observation → Checks → Report

这是最短的完整闭环：不启动子进程，不访问网络，先把框架的输入、观测、评分和报告关系跑通。

## 运行

```bash
pnpm tutorial
```

源码：[`examples/tutorial/01-mock-report.test.ts`](../../../examples/tutorial/01-mock-report.test.ts)。它属于 `*.test.ts`，因为验证对象是纯内存 `MockDriver`，零 token。

## 预期结果

测试通过后会输出一行 `TUTORIAL_SUMMARY`，其中 `dryPass`、`fuzzyPass` 都是 `true`，并给出 Markdown 与 JSON 报告路径。默认产物在 `.tmp/tutorial/mock-report/`。

## 代码怎么流动

1. `MockDriver.start()` 建立统一 driver 生命周期。
2. `sendPrompt()` 把输入归一成 `Observation`，文本会回显 prompt。
3. `buildTutorialResult()` 调用 `dryChecks` 与 `fuzzyChecks`，组装 `ScenarioResult`。
4. `writeScenarioReports()` 同时写人类可读 Markdown 和机器可读 JSON。
5. `finally` 中调用 `close()`，保证成功与失败路径都收口。

关键数据流：

```text
prompt → AgentDriver → Observation → checks → ScenarioResult → reports
```

## 换成消费者实现

保留 `buildTutorialResult` 之后的评分和报告部分，只替换：

- `MockDriver` → 消费者注册的 `AgentDriver`；
- 固定 prompt → 消费者 scenario 的当前 step；
- 教程的 fuzzy 文本 → 消费者自己的 `Criterion` 与 artifact 证据。

如果测试需要多轮，不要在这里堆循环；转到[长驻会话教程](./long-lived.md)。需要比较多个 driver/prompt 时转到[矩阵教程](./matrix-report.md)。

## 常见误区

- `Observation.text` 命中只能作为 fuzzy 证据，工具行为优先检查 `toolCalls[].status/input/output`。
- `MockDriver` 证明的是编排与评分，不证明真实 CLI 配置、协议或工具加载。
- 报告路径属于当前运行产物，不能作为稳定 API 或硬编码到消费者源码。
