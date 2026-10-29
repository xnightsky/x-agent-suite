# @x-agent-suite/matrix

Matrix 层：scenario × carrier × prompt 变体对照运行与报告。

> 本包是私有 workspace 实现模块（`private: true`、版本 `0.0.0` 占位），**不单独发布到 npm**。对外使用时走聚合包子路径 `@xnightsky/x-agent-suite/matrix`，装配方式见 [packaging 规范](../../docs/spec/packaging.md)。

## 公开入口

`src/index.ts` 是唯一入口（子路径 `@xnightsky/x-agent-suite/matrix` 同形导出）。下方示例中的 `@x-agent-suite/matrix` 是仓库内私有包名，消费者请改用子路径 `@xnightsky/x-agent-suite/matrix`：

- `runMatrix` / `createMatrixRunner` / `MatrixOptions` / `RunMatrixOptions` / `MatrixResult` / `MatrixRow`：对照编排。
- `toScenarioReportRows`：把 matrix 行转成报告行。
- `writeScenarioReports`：报告写入，直接从 `@x-agent-suite/observation` 重导出。

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

## 依赖与边界

依赖 `contracts`（类型）、`driver`（driver 契约）、`harness`（宿主组合）、`observation`（报告写入）。driver 实例由消费者经 `createDriver` 注入，本包不内置具体宿主、profile 或 scenario。

## 测试与类型检查

```bash
pnpm --filter @x-agent-suite/matrix typecheck   # 包级类型检查
pnpm --filter @x-agent-suite/matrix test        # 包级单元测试，零 token
pnpm test                                       # 仓库根：全部 *.test.ts，零 token
```

真实 provider 只能写在 `*.token.ittest.ts`，且只能经显式 `ittest:token:*` 脚本运行，不进入默认回归。判定表见 [testing 规范](../../docs/spec/testing.md)。

## 正式文档

- [matrix 对照表设计](../../docs/spec/matrix.md)
- [核心契约](../../docs/spec/contracts.md)
- [教程导航](../../docs/tutorial/README.md)
