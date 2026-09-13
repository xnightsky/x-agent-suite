/**
 * @module @x-agent-suite/runner/run-scenario
 * ScenarioSpec 执行器：逐轮驱动 → 会话观测 → 判据调度 → 可选聚合 → ScenarioResult。
 *
 * 不变量：
 * - 基础设施失败（启动失败、超时、driver 报错）显式抛错；评分不达标只进 Result；
 * - driver 由消费者工厂注入，runner 只负责 start/逐轮 sendPrompt/finally close；
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
import {
  dryChecks,
  resolveAggregate,
  runCriteria,
} from "@x-agent-suite/observation";

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
  const startedAt = Date.now();

  await driver.start();
  try {
    for (const [index, turn] of spec.turns.entries()) {
      const timeoutMs =
        turn.timeoutMs ?? spec.timeoutMs ?? deps.defaultTurnTimeoutMs ?? 60_000;
      const turnStart = Date.now();
      const observation = await sendWithTimeout(driver, turn.send, timeoutMs);
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
    }
  } finally {
    await driver.close("runScenarioSpec 完成");
  }

  const session: SessionObservation = {
    driver: spec.id,
    turns,
    text: turns.map((turn) => turn.text).join("\n"),
    toolCalls: turns.flatMap((turn) => turn.toolCalls),
    commands: [],
    exhausted: false,
    metadata: spec.metadata ?? {},
  };
  const outcomes = await runCriteria({
    session,
    criteria: deps.criteria,
    turnExpects: spec.turns.map((turn) => turn.expect),
    sessionExpect: spec.expect,
  });
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
