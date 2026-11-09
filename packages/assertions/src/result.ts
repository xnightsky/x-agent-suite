/** @module @x-agent-suite/assertions/result
 * 断言结果形状校验的唯一实现；内容 false 与畸形结果严格区分。
 */
import type { CriterionResult } from "@x-agent-suite/contracts";
/** 校验 boolean、理由与有限 0..1 标准分；畸形结果显式抛错。 */
export function assertCriterionResult(
  result: CriterionResult,
  key: string,
): void {
  if (typeof result?.pass !== "boolean")
    throw new Error("判据结果缺少 boolean pass：" + key);
  if (
    typeof result.score !== "number" ||
    !Number.isFinite(result.score) ||
    result.score < 0 ||
    result.score > 1
  ) {
    throw new Error("判据结果 score 必须是 0..1 有限数：" + key);
  }
  if (typeof result.reason !== "string")
    throw new Error("判据结果缺少字符串 reason：" + key);
}
