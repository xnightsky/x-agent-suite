/**
 * @module @x-agent-suite/contracts
 * x-agent-suite 类型契约：框架与消费者之间的全部接缝。
 *
 * 不变量：
 * - 本包不依赖任何运行时，只导出类型与轻量契约类型；
 * - 本包不认识任何具体被测系统；具体 driver / profile / 判据 / 场景由消费者注册；
 * - 领域特有需求通过 `metadata` / `evidence` / `provision` / `driverOptions` 等自由区表达。
 */

export type { Redactor } from "./redaction.ts";

export type {
  ToolCall,
  DriverEvent,
  Observation,
  TurnObservation,
  SessionObservation,
  ScenarioResult,
} from "./observation.ts";

export type {
  InboundEvent,
  InjectMode,
  AgentDriver,
  LongLivedAgentDriver,
  ParsedEvent,
  ServerSpawnSpec,
  HarnessArgsContext,
  HarnessSandboxOptions,
  PtyArgsContext,
  WriteConfigContext,
  HarnessProfile,
  HarnessDriver,
} from "./driver.ts";

export type { SandboxContext, CreateSandboxOptions } from "./sandbox.ts";

export type {
  LlmBackendMode,
  LlmBackend,
  WireProtocol,
  FixtureToolCall,
  FixtureTurn,
  FixtureProviderOptions,
} from "./fixture.ts";

export type {
  ScenarioReportRow,
  WriteReportsOptions,
  ReportPaths,
} from "./report.ts";

export type {
  HardExpectation,
  EnumerateCheck,
  EnumerateResult,
} from "./checks.ts";

export type {
  CriterionResult,
  FailureCategory,
  TurnCriterionContext,
  SessionCriterionContext,
  TurnCriterion,
  SessionCriterion,
  Criterion,
  TurnCriterionOutcome,
  SessionCriterionOutcome,
  CriterionOutcome,
} from "./criterion.ts";

export type { ExpectBlock, TurnSpec, ScenarioSpec } from "./dsl.ts";

export type { Scenario } from "./scenario.ts";

export type {
  DriverRegistration,
  LongLivedDriverRegistration,
  RegisterDriver,
  RegisterProfile,
  RegisterCriterion,
  RegisterScenario,
  Registry,
} from "./registry.ts";
