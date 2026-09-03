# @x-agent-suite/contracts

类型契约层：框架与消费者之间的全部接缝。

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
