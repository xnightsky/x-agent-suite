/**
 * @module @x-agent-suite/assertions/evidence/validation
 * 证据声明与观察的内部严格校验。
 */
import type { TurnObservation } from "@x-agent-suite/contracts";

/** 判断值是否为可校验的普通记录形状。 */
export function isEvidenceRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 拒绝声明对象中的未知字段。 */
export function assertEvidenceFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  at: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new TypeError(at + " 含未知字段 " + key);
    }
  }
}

/** 读取非空字符串声明字段。 */
export function requiredEvidenceString(value: unknown, at: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(at + " 必须是非空字符串");
  }
  return value;
}

/** 校验可选的非空正文片段清单。 */
export function parseEvidenceContains(
  value: unknown,
  at: string,
): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((item) => typeof item === "string" && item.length > 0)
  ) {
    throw new TypeError(at + " 必须是非空字符串组成的非空数组");
  }
  return value as readonly string[];
}

/** 拒绝缺失或未知工具状态，避免畸形观察进入内容判分。 */
export function assertEvidenceObservation(turn: TurnObservation): void {
  if (!Array.isArray(turn.toolCalls)) {
    throw new Error("evidence 观察不完整：toolCalls 不是数组");
  }
  for (const call of turn.toolCalls) {
    if (call.status !== "completed" && call.status !== "failed") {
      throw new Error("evidence 观察不完整：ToolCall.status 缺失或非法");
    }
  }
}
