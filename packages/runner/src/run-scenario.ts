/**
 * @module @x-agent-suite/runner/run-scenario
 * ScenarioSpec 执行器：逐轮驱动与即时判据 → 会话判据 → 可选聚合 → ScenarioResult。
 *
 * 不变量：
 * - 基础设施失败（启动失败、超时、driver 报错）显式抛错；评分不达标只进 Result；
 * - primary error 与 close/cleanup error 同时存在时用 AggregateError 全部保留；
 * - driver 由消费者工厂注入，runner 取得后即负责清理：start/逐轮 sendPrompt 同在
 *   try 内，start 失败也走 finally close；
 * - 源 spec 只读，一切状态写入发生在 driver 自己的 sandbox 内。
 */

import type {
  AgentDriver,
  AggregateResult,
  Criterion,
  CriterionOutcome,
  Observation,
  ScenarioResult,
  ScenarioSpec,
  SessionObservation,
  TurnObservation,
} from "@x-agent-suite/contracts";
import { dryChecks } from "@x-agent-suite/assertions";
import { resolveAggregate, runCriteria } from "@x-agent-suite/observation";

/** 单轮开始事件：prompt 原文仅供上层脱敏后诊断。 */
export interface ScenarioTurnStartedEvent {
  readonly type: "turn-started";
  readonly turnIndex: number;
  readonly turnCount: number;
  readonly prompt: string;
}

/** 单轮完成事件：携带本轮完整结构化 Observation。 */
export interface ScenarioTurnCompletedEvent {
  readonly type: "turn-completed";
  readonly turnIndex: number;
  readonly turnCount: number;
  readonly observation: Observation;
  readonly durationMs: number;
}

/** 一批非空判据完成事件：逐轮或会话判定后立即发出。 */
export interface ScenarioCriteriaCompletedEvent {
  readonly type: "criteria-completed";
  readonly outcomes: readonly CriterionOutcome[];
}

/** Scenario 执行过程事件；监听器异常按基础设施失败处理。 */
export type ScenarioRunEvent =
  | ScenarioTurnStartedEvent
  | ScenarioTurnCompletedEvent
  | ScenarioCriteriaCompletedEvent;

/** runScenarioSpec 注入依赖。 */
export interface RunScenarioSpecDeps {
  /** 消费者 driver 工厂（每场景调用一次；runner 负责其生命周期）。 */
  readonly createDriver: (
    spec: ScenarioSpec,
  ) => AgentDriver | Promise<AgentDriver>;
  /** 本场景可用判据集。 */
  readonly criteria: readonly Criterion[];
  /** 默认轮超时（毫秒），缺省 60_000。 */
  readonly defaultTurnTimeoutMs?: number;
  /** 结构化进度监听器；不改变执行与判定语义。 */
  readonly onEvent?: (event: ScenarioRunEvent) => void;
}

/** runner 产出的 artifact：判定明细 + 可选聚合出口。 */
export interface RunnerArtifact {
  readonly outcomes: readonly CriterionOutcome[];
  readonly aggregate?: AggregateResult;
}

/** 带超时的 sendPrompt；超时显式抛错。 */
async function sendWithTimeout(
  driver: AgentDriver,
  text: string,
  timeoutMs: number,
): Promise<Observation> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      driver.sendPrompt(text),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(`轮次超时（${timeoutMs}ms）：${text.slice(0, 50)}`),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** 按当前已执行轮次构造会话观测；逐轮判据不能看到未来输出。 */
function createSessionObservation(
  spec: ScenarioSpec,
  turns: TurnObservation[],
): SessionObservation {
  return {
    driver: spec.id,
    turns: [...turns],
    text: turns.map((turn) => turn.text).join("\n"),
    toolCalls: turns.flatMap((turn) => turn.toolCalls),
    commands: [],
    exhausted: false,
    metadata: spec.metadata ?? {},
  };
}

/** 执行一个 ScenarioSpec，返回结构化结果（含判定明细与可选聚合）。 */
export async function runScenarioSpec(
  spec: ScenarioSpec,
  deps: RunScenarioSpecDeps,
): Promise<ScenarioResult<RunnerArtifact>> {
  if (spec.turns.length === 0) {
    throw new Error(`场景 ${spec.id} 未声明任何轮次`);
  }
  const driver = await deps.createDriver(spec);
  const turns: TurnObservation[] = [];
  const observations: Observation[] = [];
  const outcomes: CriterionOutcome[] = [];
  const startedAt = Date.now();

  let primaryError: unknown;
  let hasPrimaryError = false;
  try {
    await driver.start();
    for (const [index, turn] of spec.turns.entries()) {
      const timeoutMs =
        turn.timeoutMs ?? spec.timeoutMs ?? deps.defaultTurnTimeoutMs ?? 60_000;
      const turnStart = Date.now();
      deps.onEvent?.({
        type: "turn-started",
        turnIndex: index,
        turnCount: spec.turns.length,
        prompt: turn.send,
      });
      const observation = await sendWithTimeout(driver, turn.send, timeoutMs);
      deps.onEvent?.({
        type: "turn-completed",
        turnIndex: index,
        turnCount: spec.turns.length,
        observation,
        durationMs: Date.now() - turnStart,
      });
      observations.push(observation);
      turns.push({
        index,
        sent: turn.send,
        text: observation.text,
        toolCalls: observation.toolCalls,
        commands: [],
        startedAt: turnStart,
        endedAt: Date.now(),
        metadata: observation.metadata ?? {},
      });
      const currentOutcomes = await runCriteria({
        session: createSessionObservation(spec, turns),
        criteria: deps.criteria,
        turnExpects: turns.map((_, current) =>
          current === index ? turn.expect : undefined,
        ),
      });
      outcomes.push(...currentOutcomes);
      if (currentOutcomes.length > 0) {
        deps.onEvent?.({
          type: "criteria-completed",
          outcomes: currentOutcomes,
        });
      }
    }
  } catch (error) {
    primaryError = error;
    hasPrimaryError = true;
    throw error;
  } finally {
    let cleanupError: unknown;
    let hasCleanupError = false;
    try {
      // timeout 或 send 失败后立即进入 close；driver 必须把它视为终态取消。
      await driver.close("runScenarioSpec 完成");
    } catch (error) {
      cleanupError = error;
      hasCleanupError = true;
    }
    if (hasCleanupError) {
      if (hasPrimaryError) {
        throw new AggregateError(
          [primaryError, cleanupError],
          `runScenarioSpec(${spec.id}) 失败且 close 也失败：` +
            `primary=${primaryError instanceof Error ? primaryError.message : String(primaryError)}；` +
            `cleanup=${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
        );
      }
      throw cleanupError;
    }
  }

  const session = createSessionObservation(spec, turns);
  const sessionOutcomes = await runCriteria({
    session,
    criteria: deps.criteria,
    sessionExpect: spec.expect,
  });
  outcomes.push(...sessionOutcomes);
  if (sessionOutcomes.length > 0) {
    deps.onEvent?.({ type: "criteria-completed", outcomes: sessionOutcomes });
  }
  const aggregate = spec.aggregate
    ? resolveAggregate(outcomes, spec.aggregate)
    : undefined;
  const dryPass = observations.every((item) => dryChecks(item).length === 0);
  const allCriteriaPass = outcomes.every((outcome) => outcome.pass);
  return {
    observation: observations[observations.length - 1]!,
    artifact: aggregate ? { outcomes, aggregate } : { outcomes },
    dryPass,
    hardPass: aggregate ? aggregate.pass : allCriteriaPass,
    fuzzyPass: allCriteriaPass,
    latencyMs: Date.now() - startedAt,
    error:
      (aggregate ? aggregate.pass : allCriteriaPass) || outcomes.length === 0
        ? undefined
        : (aggregate?.reason ??
          outcomes
            .filter((outcome) => !outcome.pass)
            .map((outcome) => `${outcome.name}: ${outcome.reason}`)
            .join("；")),
  };
}
