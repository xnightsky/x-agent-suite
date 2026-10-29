# @x-agent-suite/contracts

类型契约层：框架与消费者之间的全部接缝。

> 本包是私有 workspace 实现模块（`private: true`、版本 `0.0.0` 占位），**不单独发布到 npm**。对外使用时走聚合包子路径 `@xnightsky/x-agent-suite/contracts`，装配方式见 [packaging 规范](../../docs/spec/packaging.md)。

## 设计纪律

- 本包只导出类型与轻量契约，不依赖任何运行时。
- 本包不认识任何具体被测系统；具体 driver / profile / 判据 / 场景由消费者注册。
- 领域特有需求通过 `metadata` / `evidence` / `provision` / `driverOptions` 等自由区表达。

## 主要模块

| 模块                         | 说明                                                                     |
| ---------------------------- | ------------------------------------------------------------------------ |
| `driver.ts`                  | `AgentDriver`、`LongLivedAgentDriver`、`HarnessProfile`、`HarnessDriver` |
| `fixture.ts`                 | `LlmBackend`、`WireProtocol`、`FixtureTurn`                              |
| `observation.ts`             | `Observation`、`ScenarioResult`、`ToolCall`、`DriverEvent`               |
| `checks.ts` / `criterion.ts` | 判据与评分契约                                                           |
| `dsl.ts`                     | `ScenarioSpec` / `TurnSpec` / `ExpectBlock`                              |
| `registry.ts`                | `Registry` 注册表函数类型                                                |
| `report.ts`                  | `ScenarioReportRow` / `WriteReportsOptions`                              |
| `sandbox.ts`                 | `SandboxContext` / `CreateSandboxOptions`                                |

## 公开入口

`src/index.ts` 是唯一入口（子路径 `@xnightsky/x-agent-suite/contracts` 同形导出）。它只做类型再导出，无运行时逻辑、无运行时依赖；上表各模块的实现分别在 `packages/*/src/`。

## 最小示例

```ts
import type {
  Observation,
  ScenarioSpec,
  Criterion,
} from "@xnightsky/x-agent-suite/contracts";

export const scenario: ScenarioSpec = {
  id: "hello",
  turns: [{ send: "hello", expect: { "text-contains": ["hello"] } }],
};

export type CriterionShape = Criterion; // 判据实现由消费者提供
export type LastTurn = Observation;
```

## 依赖与边界

本包零运行时依赖，被全部其他包依赖，是唯一的契约真相源。新增字段前先确认第二个消费者是否需要；领域特有需求走 `metadata` / `evidence` / `provision` / `driverOptions` 自由区，不为单个消费者扩展契约。边界纪律见 [boundary-discipline](../../docs/spec/boundary-discipline.md)。

## 测试与类型检查

```bash
pnpm --filter @x-agent-suite/contracts typecheck   # 包级类型检查（本包无独立 test 脚本）
pnpm test                                          # 仓库根：统一跑 packages/*/tests/*.test.ts，零 token
```

## 正式文档

- [核心契约](../../docs/spec/contracts.md)
- [边界纪律：四条守卫与三个合法出口](../../docs/spec/boundary-discipline.md)
- [教程导航](../../docs/tutorial/README.md)
