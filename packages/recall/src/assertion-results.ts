/**
 * @module @x-agent-suite/recall/assertion-results
 * Recall 报告投影：还原本轮/case 作者名并组合通用贡献细项；原始标准分不改写。
 */
import type {
  RecallCompositeAssertion,
  RecallCompositePayload,
  RecallComposition,
  RecallRepeatSnapshot,
} from "./first-of-records.ts";
import {
  assertionContribution,
  type AssertionDetail,
} from "@x-agent-suite/assertions";
import type {
  CriterionOutcome,
  ScenarioResult,
  ScenarioSpec,
} from "@x-agent-suite/contracts";
import type { RunnerArtifact } from "@x-agent-suite/runner";
import {
  recallJudgeCriterionName,
  type RecallJudgeDefinition,
  type RecallJudgeRubricDefinition,
} from "./assertion-dsl.ts";
import { recallMechanicalAssertionScore } from "./assertion-score.ts";
import type { RecallResolvedExecution } from "./execution.ts";
import type { RecallRepeatScoreSummary } from "./score-summary.ts";

/** Recall 的有效明细允许组合来源，不更改通用断言契约。 */
export type RecallAssertionDetail = AssertionDetail | RecallCompositeAssertion;

/** 带 Recall 报告投影的 Runner artifact；不改变 RunnerArtifact 本身。 */
export interface RecallAssertionArtifact extends RunnerArtifact {
  readonly assertions?: readonly RecallAssertionDetail[];
  readonly compositions?: readonly RecallComposition[];
  readonly repeats?: readonly RecallRepeatSnapshot[];
  readonly rawScore?: number;
  readonly scoreSummary?: RecallRepeatScoreSummary;
}

interface RecallTurnAssertionMetadata {
  readonly judge?: RecallJudgeDefinition;
}

interface RecallAssertionMetadata {
  readonly judge?: RecallJudgeDefinition;
  readonly turnAssertions?: readonly RecallTurnAssertionMetadata[];
}

/** 作者视图投影：只保留唯一有效贡献，组合诊断独立挂载。 */
export interface RecallAssertionProjection {
  readonly outcome: CriterionOutcome;
  readonly assertion: RecallAssertionDetail;
  readonly composition?: RecallComposition;
}

function assertionMetadata(spec: ScenarioSpec): RecallAssertionMetadata {
  return (spec.metadata?.recall as RecallAssertionMetadata | undefined) ?? {};
}

function rubricOf(
  outcome: CriterionOutcome,
  judge: RecallJudgeDefinition | undefined,
): readonly [string, RecallJudgeRubricDefinition] | undefined {
  const name = Object.keys(judge?.rubrics ?? {}).find(
    (candidate) => recallJudgeCriterionName(candidate) === outcome.name,
  );
  return name ? [name, judge!.rubrics[name]!] : undefined;
}

/** 将单个 Runner outcome 投影为作者名、判据明细与实际贡献。 */
export function projectRecallAssertionOutcome(
  spec: ScenarioSpec,
  outcome: CriterionOutcome,
  execution?: RecallResolvedExecution,
): RecallAssertionProjection {
  const { __recallComposition: composite, ...base } =
    outcome as CriterionOutcome & Partial<RecallCompositePayload>;
  if (composite)
    return {
      outcome: { ...base, name: composite.assertion.name } as CriterionOutcome,
      assertion: composite.assertion,
      composition: composite.composition,
    };
  const metadata = assertionMetadata(spec);
  const turn =
    outcome.scope === "turn"
      ? metadata.turnAssertions?.[outcome.turnIndex]
      : undefined;
  const judge = outcome.scope === "turn" ? turn?.judge : metadata.judge;
  const rubric = rubricOf(outcome, judge);
  let name: string;
  if (outcome.scope === "turn") {
    name = rubric
      ? `turn.${outcome.turnIndex}.judge.${rubric[0]}`
      : outcome.name;
  } else {
    name = rubric ? `judge.${rubric[0]}` : outcome.name;
  }
  return {
    outcome: { ...outcome, name },
    assertion: {
      name,
      source: rubric ? "ai" : "mechanical",
      pass: outcome.pass,
      reason: outcome.reason,
      score: rubric
        ? assertionContribution(outcome.pass, rubric[1].score)
        : execution
          ? recallMechanicalAssertionScore(execution, spec, outcome)
          : assertionContribution(outcome.pass),
    },
  };
}

/** 去掉 JSON 中无意义的显式 undefined error 字段。 */
function withoutUndefinedError(
  result: ScenarioResult<RunnerArtifact>,
): ScenarioResult<RunnerArtifact> {
  if (result.error !== undefined) return result;
  const { error: _error, ...rest } = result;
  return rest;
}

/** 将 Runner 结果改为 Recall 作者视图；无任何 turn/case expect 时保持原结果。 */
export function adaptRecallAssertionResult(
  spec: ScenarioSpec,
  result: ScenarioResult<RunnerArtifact>,
  execution?: RecallResolvedExecution,
): ScenarioResult<RecallAssertionArtifact> {
  if (!spec.expect && !spec.turns.some((turn) => turn.expect)) {
    return withoutUndefinedError(result);
  }
  const projected = result.artifact.outcomes.map((outcome) =>
    projectRecallAssertionOutcome(spec, outcome, execution),
  );
  const outcomes = projected.map((item) => item.outcome);
  const assertions = projected.map((item) => item.assertion);
  const rawScore = assertions.reduce((sum, item) => sum + item.score, 0);
  const failed = assertions.filter((item) => !item.pass);
  const failedReasons = failed
    .map((item) => item.name + ": " + item.reason)
    .join("；");
  const error = result.hardPass
    ? undefined
    : result.error && result.error.length > 0
      ? result.error
      : failedReasons || undefined;
  const { error: _existingError, ...base } = result;
  return {
    ...base,
    artifact: {
      ...result.artifact,
      outcomes,
      assertions,
      rawScore,
      ...(projected.some((item) => item.composition)
        ? {
            compositions: projected.flatMap((item) =>
              item.composition ? [item.composition] : [],
            ),
          }
        : {}),
    },
    ...(error === undefined ? {} : { error }),
  };
}
