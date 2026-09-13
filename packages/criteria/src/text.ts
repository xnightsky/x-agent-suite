/**
 * @module @x-agent-suite/criteria/text
 * 文本类判据：包含（AND）与红线排除。
 * 不变量：expect 形状非法显式抛错（配置错误不等于评测失败）。
 */

import type { CriterionResult, TurnCriterion } from "@x-agent-suite/contracts";

/** 校验并归一 expect 为字符串列表；非法形状显式抛错。 */
function asExpectList(
  expect: unknown,
  criterionName: string,
): readonly string[] {
  const list = typeof expect === "string" ? [expect] : expect;
  if (
    !Array.isArray(list) ||
    list.length === 0 ||
    !list.every((item) => typeof item === "string" && item.length > 0)
  ) {
    throw new TypeError(
      `${criterionName} 的 expect 必须是非空字符串或非空字符串数组，实际：${JSON.stringify(expect)}`,
    );
  }
  return list as readonly string[];
}

/**
 * 文本包含判据（AND 语义）：expect 列出的文本全部出现才通过。
 * expect：`string | string[]`。
 */
export const textContains: TurnCriterion = {
  name: "text-contains",
  scope: "turn",
  evaluate(turn, context): CriterionResult {
    const expected = asExpectList(context.expect, "text-contains");
    const missing = expected.filter((keyword) => !turn.text.includes(keyword));
    return missing.length === 0
      ? { pass: true, score: 1, reason: `全部 ${expected.length} 个关键词命中` }
      : { pass: false, score: 0, reason: `缺少关键词：${missing.join("、")}` };
  },
};

/**
 * 红线排除判据：expect 列出的文本任一出现即失败。
 * expect：`string | string[]`。
 */
export const textNotContains: TurnCriterion = {
  name: "text-not-contains",
  scope: "turn",
  evaluate(turn, context): CriterionResult {
    const redLines = asExpectList(context.expect, "text-not-contains");
    const hits = redLines.filter((keyword) => turn.text.includes(keyword));
    return hits.length === 0
      ? { pass: true, score: 1, reason: "红线均未出现" }
      : { pass: false, score: 0, reason: `命中红线：${hits.join("、")}` };
  },
};
