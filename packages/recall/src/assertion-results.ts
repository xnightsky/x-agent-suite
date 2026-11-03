/**
 * @module @x-agent-suite/recall/assertion-results
 * Recall 报告投影：还原本轮/case 作者名并组合通用贡献细项；原始标准分不改写。
 */
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

/** 带 Recall 报告投影的 Runner artifact；不改变 RunnerArtifact 本身。 */
export interface RecallAssertionArtifact extends RunnerArtifact {
  readonly assertions?: readonly AssertionDetail[];
  readonly rawScore?: number;
}

interface RecallTurnAssertionMetadata {
  readonly judge?: RecallJudgeDefinition;
}

interface RecallAssertionMetadata {
  readonly judge?: RecallJudgeDefinition;
  readonly turnAssertions?: readonly RecallTurnAssertionMetadata[];
}

interface ProjectedOutcome {
  readonly outcome: CriterionOutcome;
  readonly assertion: AssertionDetail;
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

function projectOutcome(
  spec: ScenarioSpec,
  outcome: CriterionOutcome,
  execution?: RecallResolvedExecution,
): ProjectedOutcome {
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

/** 将 Runner 结果改为 Recall 作者视图；无任何 turn/case expect 时保持原结果。 */
export function adaptRecallAssertionResult(
  spec: ScenarioSpec,
  result: ScenarioResult<RunnerArtifact>,
  execution?: RecallResolvedExecution,
): ScenarioResult<RecallAssertionArtifact> {
  if (!spec.expect && !spec.turns.some((turn) => turn.expect)) return result;
  const projected = result.artifact.outcomes.map((outcome) =>
    projectOutcome(spec, outcome, execution),
  );
  const outcomes = projected.map((item) => item.outcome);
  const assertions = projected.map((item) => item.assertion);
  const rawScore = assertions.reduce((sum, item) => sum + item.score, 0);
  const failed = assertions.filter((item) => !item.pass);
  return {
    ...result,
    artifact: { ...result.artifact, outcomes, assertions, rawScore },
    error: result.hardPass
      ? undefined
      : failed.map((item) => item.name + ": " + item.reason).join("；"),
  };
}
