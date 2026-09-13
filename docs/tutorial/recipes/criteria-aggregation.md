# Criteria → Aggregation → Report

这一条演示判定与打分的完整闭环：用 MockDriver 产出 Observation，经 `runCriteria` 调度判据，
再由 `resolveAggregate` 聚合成出口分，最后写双格式报告。

## 运行

```bash
pnpm tutorial:aggregate
```

源码：[`examples/tutorial/12-criteria-aggregation.test.ts`](../../../examples/tutorial/12-criteria-aggregation.test.ts)。
纯 mock、零 token，归单元测试层。

## 预期结果

`TUTORIAL_SUMMARY` 应包含：

- `states: ["hit", "hit", "miss", "absent"]`：文本包含与红线排除命中、工具未调用（miss）、
  未评测维度（absent）四种状态同框；
- `coverage: { evaluated: 3, total: 4 }`：缺席维计入分母披露，不静默；
- `pass: false`：`score = 1/5 = 0.2` 低于 `threshold: 0.5`。

## 代码怎么流动

1. `MockDriver.sendPrompt` 回显 prompt，产出 `Observation`；
2. 消费者胶水把一次性 `Observation` 归一成单轮 `SessionObservation`；
3. `runCriteria` 按 `turnExpects` 把三个判据分发到第 0 轮，产出 `CriterionOutcome[]`——
   **同一入口离线可复跑**：不起 driver，拿已有 Observation 即可判分；
4. `resolveAggregate` 按维度声明（weight / absent / threshold）聚合出出口分；
5. `AggregateResult` 经 `ScenarioResult.artifact` 透传进 JSON 报告（coverage 随之落盘）。

## 换成消费者实现

- 把 `[textContains, textNotContains, toolCall]` 换成消费者注册的领域判据；
- 维度声明放在消费者的场景文件里（runner 落地前框架不规定载体）；
- 判据名拼错会被两道闸拦住：`runCriteria` 的引用完整性抛错 + 聚合 reason 点名无结果引用。

## 常见误区

- expect 块的键是 **metric 名**（kebab-case：`text-contains` / `tool-call`），不是导出名（`textContains`）；写错会被引用完整性检查显式抛错。
- 不要把「判据没跑」当「判据没过」：缺席走 `absent` 映射并计入 coverage，语义不同；
- 不要在报告里直接比较不同 coverage 的聚合分。
