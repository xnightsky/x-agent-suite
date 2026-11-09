/**
 * @module @x-agent-suite/recall/assertion-score
 * Recall 装配接缝：调用通用 resolver、逐 execution/scenario 缓存配置；不做分值算法。
 */
import {
  isFirstOfKey,
  mechanicalEntries,
  type RecallFirstOfBranch,
} from "./first-of-dsl.ts";
import type { ExpectBlock } from "@x-agent-suite/contracts";
import {
  assertionContribution,
  parseAssertionScore,
  type AssertionScoreConfig,
} from "@x-agent-suite/assertions";
import type { CriterionOutcome, ScenarioSpec } from "@x-agent-suite/contracts";
import type { RecallResolvedExecution } from "./execution.ts";
import type {
  RecallCriterionRegistration,
  RecallRegistry,
} from "./registry.ts";

type ScenarioScores = Map<string, AssertionScoreConfig>;
const CACHE = new WeakMap<
  RecallResolvedExecution,
  WeakMap<ScenarioSpec, ScenarioScores>
>();

/** 机械分值预检入参；与判据装配使用同一批 scenario/execution。 */
export interface PreflightRecallAssertionScoresOptions {
  readonly registry: RecallRegistry;
  readonly scenarios: readonly ScenarioSpec[];
  readonly execution: RecallResolvedExecution;
}

function outcomeKey(
  scope: "turn" | "session",
  name: string,
  turnIndex?: number,
): string {
  return scope === "turn"
    ? "turn:" + String(turnIndex) + ":" + name
    : "session:" + name;
}

function resolve(
  registration: RecallCriterionRegistration,
  expect: unknown,
  key: string,
): AssertionScoreConfig | undefined {
  const resolver = registration.assertionScore;
  if (!resolver) return undefined;
  let value: AssertionScoreConfig;
  try {
    value = resolver(expect);
  } catch (cause) {
    throw new Error("Recall assertionScore 解析失败：" + key, { cause });
  }
  return parseAssertionScore(value, "Recall assertionScore " + key);
}

function registrations(
  registry: RecallRegistry,
): ReadonlyMap<string, RecallCriterionRegistration> {
  return new Map(
    registry.criteria.map((item) => [item.scope + ":" + item.name, item]),
  );
}

function resolveIfReferenced(
  index: ReadonlyMap<string, RecallCriterionRegistration>,
  scores: ScenarioScores,
  scope: "turn" | "session",
  name: string,
  expect: unknown,
  turnIndex?: number,
): void {
  const registration = index.get(scope + ":" + name);
  if (!registration) return;
  const key = outcomeKey(scope, name, turnIndex);
  const score = resolve(registration, expect, key);
  if (score) scores.set(key, score);
}

function preflightBranches(
  block: ExpectBlock | undefined,
  index: ReadonlyMap<string, RecallCriterionRegistration>,
  path: string,
): void {
  for (const [name, value] of Object.entries(block ?? {})) {
    if (!isFirstOfKey(name)) continue;
    for (const [branchIndex, branch] of (
      value as readonly RecallFirstOfBranch[]
    ).entries()) {
      for (const [metric, input] of mechanicalEntries(branch.expect)) {
        const registration = index.get(
          path.startsWith("turn:") ? "turn:" + metric : "session:" + metric,
        );
        if (registration)
          resolve(
            registration,
            input,
            `${path}:${name}:${branchIndex}:${metric}`,
          );
      }
    }
  }
}

/** 只解析实际引用的 opt-in 注册项；任何错误都发生在主 Driver 创建之前。 */
export function preflightRecallAssertionScores(
  options: PreflightRecallAssertionScoresOptions,
): void {
  const index = registrations(options.registry);
  let byScenario = CACHE.get(options.execution);
  if (!byScenario) {
    byScenario = new WeakMap<ScenarioSpec, ScenarioScores>();
    CACHE.set(options.execution, byScenario);
  }
  for (const scenario of options.scenarios) {
    const scores: ScenarioScores = new Map();
    for (const [turnIndex, turn] of scenario.turns.entries()) {
      preflightBranches(turn.expect, index, "turn:" + turnIndex);
      for (const [name, expect] of Object.entries(turn.expect ?? {})) {
        resolveIfReferenced(index, scores, "turn", name, expect, turnIndex);
      }
    }
    for (const [name, expect] of Object.entries(scenario.expect ?? {})) {
      resolveIfReferenced(index, scores, "session", name, expect);
    }
    preflightBranches(scenario.expect, index, "session");
    byScenario.set(scenario, scores);
  }
}

/** 读取预检配置并交给通用贡献算法；未 opt-in 时使用通用默认值。 */
export function recallMechanicalAssertionScore(
  execution: RecallResolvedExecution,
  scenario: ScenarioSpec,
  outcome: CriterionOutcome,
): number {
  const key = outcomeKey(
    outcome.scope,
    outcome.name,
    outcome.scope === "turn" ? outcome.turnIndex : undefined,
  );
  const score = CACHE.get(execution)?.get(scenario)?.get(key);
  return assertionContribution(outcome.pass, score);
}
