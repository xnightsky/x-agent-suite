/**
 * @module @x-agent-suite/assertions/judge/results
 * JudgeOutcome → 每 rubric 原始断言结果；只映射 boolean 与 0/1，不计算作者贡献。
 */
import type { CriterionResult } from "@x-agent-suite/contracts";
import type { JudgeOutcome } from "@x-agent-suite/judge";

/** 一个具名原始断言结果；score 遵循 CriterionResult 的 0..1 语义。 */
export interface NamedAssertionResult extends CriterionResult {
  readonly name: string;
}

/** 解包批量裁定并展开细项；缺证据与不可评测不得伪装成内容失败。 */
export function judgeAssertionResults(
  outcome: JudgeOutcome,
  assertionName: string,
): readonly NamedAssertionResult[] {
  if (outcome.status === "not-evaluated") {
    const { kind, message } = outcome.failure;
    throw new Error(
      "[not-evaluated:" +
        kind +
        "] 判据 " +
        assertionName +
        " 本次不可评测：" +
        message,
    );
  }
  if (outcome.absent.length > 0) {
    throw new Error(
      "[absent] 判据 " +
        assertionName +
        " 缺少 rubric 证据：" +
        outcome.absent.join("、"),
    );
  }
  return outcome.verdicts.map((verdict) => ({
    name: verdict.name,
    pass: verdict.pass,
    score: verdict.pass ? 1 : 0,
    reason: verdict.reason,
  }));
}
