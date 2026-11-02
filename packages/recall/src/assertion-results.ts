/**
 * @module @x-agent-suite/recall/assertion-results
 * Recall 报告投影：还原作者名并组合通用贡献细项；原始 outcomes 不改写。
 */
import {
  assertionContribution,
  type AssertionDetail,
} from "@x-agent-suite/assertions";
import type { ScenarioResult, ScenarioSpec } from "@x-agent-suite/contracts";
import type { RunnerArtifact } from "@x-agent-suite/runner";
import {
  recallJudgeCriterionName,
  type RecallJudgeDefinition,
} from "./assertion-dsl.ts";
import { recallMechanicalAssertionScore } from "./assertion-score.ts";
import type { RecallResolvedExecution } from "./execution.ts";

/** 带 Recall 报告投影的 Runner artifact；不改变 RunnerArtifact 本身。 */
export interface RecallAssertionArtifact extends RunnerArtifact {
  readonly assertions?: readonly AssertionDetail[];
  readonly rawScore?: number;
}

function judgeMetadata(spec: ScenarioSpec): RecallJudgeDefinition | undefined {
  const recall = spec.metadata?.recall as
    { judge?: RecallJudgeDefinition } | undefined;
  return recall?.judge;
}

/** 将 Runner 结果改为 Recall 作者视图；无 case expect 时保持原结果。 */
export function adaptRecallAssertionResult(
  spec: ScenarioSpec,
  result: ScenarioResult<RunnerArtifact>,
  execution?: RecallResolvedExecution,
): ScenarioResult<RecallAssertionArtifact> {
  if (!spec.expect) return result;
  const judge = judgeMetadata(spec);
  const outcomes = result.artifact.outcomes.map((outcome) => {
    const publicName = Object.keys(judge?.rubrics ?? {}).find(
      (name) => recallJudgeCriterionName(name) === outcome.name,
    );
    return publicName ? { ...outcome, name: publicName } : outcome;
  });
  const assertions: AssertionDetail[] = outcomes.map((outcome) => {
    const declaration = judge?.rubrics[outcome.name];
    return {
      name: outcome.name,
      source: declaration ? "ai" : "mechanical",
      pass: outcome.pass,
      reason: outcome.reason,
      score: declaration
        ? assertionContribution(outcome.pass, declaration.score)
        : execution
          ? recallMechanicalAssertionScore(execution, spec, outcome)
          : assertionContribution(outcome.pass),
    };
  });
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
