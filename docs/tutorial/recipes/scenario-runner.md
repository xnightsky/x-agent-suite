# Scenario Runner：一条命令跑完整考卷

这一条演示 P3 的端到端形态：把 3 个场景声明进一个 config 模块，
`x-agent-suite eval` 一条命令完成 driver 驱动、判据调度、聚合打分与双格式报告。

## 运行

```bash
pnpm tutorial:runner
```

源码：[`examples/tutorial/13-scenario-runner.test.ts`](../../../examples/tutorial/13-scenario-runner.test.ts)，
config：[`examples/tutorial/fixtures/tutorial-runner.config.ts`](../../../examples/tutorial/fixtures/tutorial-runner.config.ts)。
纯 mock、零 token，归单元测试层。

## 预期结果

`TUTORIAL_SUMMARY` 应包含：

- `exitCode: 0`——`runner-fail` 场景判据未过是**行为结论**，不影响退出码
  （确定性层与行为层分离，见 `docs/spec/scenario-evaluation.md`）；
- `reports: 3`——三个场景各出一份 md + json 报告；
- 聚合场景 `coverage: { evaluated: 2, total: 3 }`（style 维度缺席计入分母）。

## 代码怎么流动

1. `main(["eval", configPath])` 加载 config 模块并校验形状；
2. 逐场景 `runScenarioSpec`：`createDriver(spec)` 拿 driver → 逐轮 `sendPrompt`
   （轮 > 场景 > 默认 60s 三级超时）→ `runCriteria` → `resolveAggregate`（声明了
   `aggregate` 时）；
3. 每场景写 md + json 报告，聚合结果经 `artifact` 透传进 JSON；
4. 任一场景基础设施失败（启动失败/超时/驱动报错）→ 退出码 1；用法错误 → 2。

## repeat：稳定率维度

config 加 `repeat: N` 后每个场景顺序执行 N 次（本教程 config 即 `repeat: 2`）：

- 报告行多出 `repeat` 统计：稳定率（`hardPassCount/runs`）、fuzzy 稳定率、
  聚合分均值/极值（仅声明了 `aggregate` 的场景）；
- md 报告出现「稳定率」列（如 `2/2 μ1.00`），JSON 行携带完整 `RepeatStats`；
- 任一基础设施失败立即抛出——统计不掩盖基础设施问题；
- 报告里的代表结果是**最后一次**执行（确定性选择，排查时知道看哪次）。

## config 为什么是代码模块

判据与 driver 工厂本就是函数，YAML 放不下（promptfoo 被迫逃向 `.mjs` 的前车之鉴）。
`x-agent-suite.config.ts` 一等公民化留待首个消费者验证。

## 换成消费者实现

- `createDriver` 换成 harness 工厂（P7 接线）或任何自持 driver；
- `criteria` 换成消费者注册的领域判据；`aggregate` 维度声明随考卷走；
- 报告目录用 `outDir` 或 `XAS_TUTORIAL_OUT_DIR` 环境变量接管。

## 常见误区

- expect 块的键是 **metric 名**（kebab-case，如 `text-contains`），不是判据导出名；
- 不要用退出码表达「评测过没过」——退出码只表达基础设施成败；
- 行为结论看报告的 `hardPass` / 聚合分，配合 coverage 一起读。
