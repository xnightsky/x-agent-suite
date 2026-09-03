# @x-agent-suite/matrix

Matrix 层：scenario × carrier × prompt 变体对照运行与报告。

## API

```ts
import {
  runMatrix,
  toScenarioReportRows,
  writeScenarioReports,
} from "@x-agent-suite/matrix";

const result = await runMatrix(
  {
    carriers: ["kimi", "codex"],
    getVariants: async (scenarioId) => ["concise", "detailed"],
    createDriver: async (carrier) => makeDriver(carrier),
    runScenario: async ({ scenarioId, carrier, promptVariant, driver }) => {
      const observation = await driver.sendPrompt(promptVariant);
      return score(observation);
    },
  },
  { scenarioId: "send-message" },
);

await writeScenarioReports(toScenarioReportRows(result.rows), {
  scenarioId: "send-message",
});
```

## 设计纪律

- 本包不内置任何具体 scenario / driver / profile。
- 变体间串行；同一变体内不同 carrier 并行。
- 单个 carrier 运行或关闭失败 → skip 行并保留原因，不影响其余 carrier。
- 报告由 `@x-agent-suite/observation` 统一写入。
