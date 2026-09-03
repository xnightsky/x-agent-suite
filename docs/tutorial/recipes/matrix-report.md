# Driver × Variant → Matrix → Report

这一条把两个 driver 标识与两个 prompt 变体做有意义的组合，得到四行对照结果和统一报告。

## 运行

```bash
pnpm tutorial:matrix
```

源码：[`examples/tutorial/04-matrix.test.ts`](../../../examples/tutorial/04-matrix.test.ts)。全部 driver 都是 mock，属于 `*.test.ts`。

## 预期结果

`TUTORIAL_SUMMARY` 中应为 `okCount: 4`、`skipCount: 0`、`failCount: 0`；JSON 报告的 `rows` 长度为 4。

## 四个接缝

`runMatrix` 不认识任何具体宿主或 scenario，只调用消费者提供的四个接缝：

| 接缝           | 教程值                          | 消费者替换点                         |
| -------------- | ------------------------------- | ------------------------------------ |
| `carriers`     | `mock-a`、`mock-b`              | 已注册 driver/profile ID             |
| `getVariants`  | `brief`、`detailed`             | prompt 文件或版本发现器              |
| `createDriver` | 每行创建一个 `MockDriver`       | registry 中的 driver factory         |
| `runScenario`  | 单轮发送并构造 `ScenarioResult` | 消费者多轮 runner + criterion + 证据 |

单行创建、运行或关闭失败会落成 skip/fail 行，不应打断其它组合；最终是否允许“全 skip”由消费者验收策略决定。

## 不要机械做笛卡尔积

矩阵轴必须改变一个可解释变量。无语义组合（如 `MockDriver + LiveBackend`）不要生成；backend 只属于实际使用模型渠道的 harness 路径，criterion 只在 Observation 归一后运行。

## 扩展顺序

1. 先固定 scenario 与 criterion，只增加 carrier。
2. 再增加 prompt variant，确认报告能解释差异来源。
3. fixture 全绿后才增加真实宿主 `*.ittest.ts` 行。
4. live 对照另建 `*.token.ittest.ts`，不得混入默认 matrix 回归。
