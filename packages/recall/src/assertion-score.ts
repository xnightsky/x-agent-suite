/**
 * @module @x-agent-suite/recall/assertion-score
 * Recall 装配接缝：调用通用 resolver、逐 execution/scenario/分支缓存配置；不做组合选择。
 */
import {
  compositionKindOfKey,
  mechanicalEntries,
  type RecallCompositionBranch,
  type RecallCompositionKind,
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
type Scope = "turn" | "session";
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

function outcomeKey(scope: Scope, name: string, turnIndex?: number): string {
  return scope === "turn"
    ? "turn:" + String(turnIndex) + ":" + name
    : "session:" + name;
}

function branchOutcomeKey(
  scope: Scope,
  turnIndex: number | undefined,
  compositionKey: string,
  branchIndex: number,
  metric: string,
): string {
  return [
    "branch",
    scope,
    turnIndex ?? "-",
    compositionKey,
    branchIndex,
    metric,
  ].join(":");
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
  scope: Scope,
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

function branchMiss(
  scores: ScenarioScores,
  scope: Scope,
  turnIndex: number | undefined,
  compositionKey: string,
  branch: RecallCompositionBranch,
  branchIndex: number,
): number {
  if (branch.score !== undefined) return branch.score.miss ?? -1;
  const judgeMiss = Object.values(branch.expect.judge?.rubrics ?? {}).reduce(
    (sum, rubric) => sum + (rubric.score?.miss ?? -1),
    0,
  );
  return mechanicalEntries(branch.expect).reduce((sum, [metric]) => {
    const score = scores.get(
      branchOutcomeKey(scope, turnIndex, compositionKey, branchIndex, metric),
    );
    return sum + (score?.miss ?? -1);
  }, judgeMiss);
}

function preflightBranches(
  block: ExpectBlock | undefined,
  index: ReadonlyMap<string, RecallCriterionRegistration>,
  scores: ScenarioScores,
  scope: Scope,
  turnIndex?: number,
): void {
  for (const [name, value] of Object.entries(block ?? {})) {
    const kind: RecallCompositionKind | undefined = compositionKindOfKey(name);
    if (!kind) continue;
    const branches = value as readonly RecallCompositionBranch[];
    for (const [branchIndex, branch] of branches.entries()) {
      for (const [metric, input] of mechanicalEntries(branch.expect)) {
        const registration = index.get(scope + ":" + metric);
        if (!registration) continue;
        const key = branchOutcomeKey(
          scope,
          turnIndex,
          name,
          branchIndex,
          metric,
        );
        const score = resolve(
          registration,
          input,
          scope +
            ":" +
            String(turnIndex) +
            ":" +
            name +
            ":" +
            branchIndex +
            ":" +
            metric,
        );
        if (score) scores.set(key, score);
      }
    }
    if (kind === "allOf") continue;
    const misses = branches.map((branch, branchIndex) =>
      branchMiss(scores, scope, turnIndex, name, branch, branchIndex),
    );
    if (misses.some((miss) => miss !== misses[0]))
      throw new Error("Recall " + kind + " 各分支共同 miss 必须一致：" + name);
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
      preflightBranches(turn.expect, index, scores, "turn", turnIndex);
      for (const [name, expect] of Object.entries(turn.expect ?? {})) {
        resolveIfReferenced(index, scores, "turn", name, expect, turnIndex);
      }
    }
    for (const [name, expect] of Object.entries(scenario.expect ?? {})) {
      resolveIfReferenced(index, scores, "session", name, expect);
    }
    preflightBranches(scenario.expect, index, scores, "session");
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

/** 读取组合内机械叶子的缓存分值并计算实际贡献，不再次调用 resolver。 */
export function recallCompositionMechanicalAssertionScore(
  execution: RecallResolvedExecution,
  scenario: ScenarioSpec,
  scope: Scope,
  turnIndex: number | undefined,
  compositionKey: string,
  branchIndex: number,
  outcome: CriterionOutcome,
): number {
  const key = branchOutcomeKey(
    scope,
    turnIndex,
    compositionKey,
    branchIndex,
    outcome.name,
  );
  const score = CACHE.get(execution)?.get(scenario)?.get(key);
  return assertionContribution(outcome.pass, score);
}

/** 返回已预检分支的共同 miss 输入；显式分支 score 优先于内部叶子。 */
export function recallCompositionBranchMiss(
  execution: RecallResolvedExecution,
  scenario: ScenarioSpec,
  scope: Scope,
  turnIndex: number | undefined,
  compositionKey: string,
  branch: RecallCompositionBranch,
  branchIndex: number,
): number {
  const scores = CACHE.get(execution)?.get(scenario);
  if (!scores) throw new Error("Recall 组合分值尚未完成预检");
  return branchMiss(
    scores,
    scope,
    turnIndex,
    compositionKey,
    branch,
    branchIndex,
  );
}
