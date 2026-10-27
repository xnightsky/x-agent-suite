/**
 * @module @x-agent-suite/recall/validation
 * Recall 内部共享的严格输入形状校验；不承载领域语义。
 */

/** 判断普通记录对象。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 判断非空字符串（纯空白也拒绝）。 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** 判断正整数配置值。 */
export function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** 拒绝记录中的未知字段。 */
export function assertKnownFields(
  record: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) throw new Error(path + " 含未知字段 " + key);
  }
}

/** 读取必填非空字符串。 */
export function requiredString(value: unknown, path: string): string {
  if (!isNonEmptyString(value)) throw new Error(path + " 必须是非空字符串");
  return value;
}
