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

/** 可选非空字符串：undefined 表示省略，其他非法值显式拒绝。 */
export function assertOptionalNonEmptyString(
  value: unknown,
  path: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (!isNonEmptyString(value)) {
    throw new Error(path + " 必须是非空字符串");
  }
  return value;
}

/** 可选 boolean：undefined 表示省略，其他类型显式拒绝。 */
export function assertOptionalBoolean(
  value: unknown,
  path: string,
): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(path + " 必须是 boolean");
  }
  return value;
}

/** 路径冲突比较键：统一 Unicode NFC 与大小写，覆盖跨平台大小写别名。 */
export function pathCollisionKey(value: string): string {
  return value.normalize("NFC").toLowerCase();
}

/** 编码报告路径的单个安全段；拒绝空段、. 与 .. 以及不可编码值。 */
export function encodeSafePathSegment(value: unknown, path: string): string {
  if (!isNonEmptyString(value)) {
    throw new Error(path + " 必须是非空路径段");
  }
  if (value === "." || value === "..") {
    throw new Error(path + " 不得是 . 或 ..");
  }
  let encoded: string;
  try {
    encoded = encodeURIComponent(value);
  } catch (cause) {
    throw new Error(path + " 无法编码为安全路径段", { cause });
  }
  if (!encoded || encoded === "." || encoded === "..") {
    throw new Error(path + " 必须编码为非空安全路径段");
  }
  return encoded;
}

/** YAML parser 错误中的 1-based 行列位置；不读取或返回源文本。 */
export function yamlErrorLocation(cause: unknown): {
  readonly line: number | undefined;
  readonly column: number | undefined;
} {
  if (typeof cause !== "object" || cause === null) {
    return { line: undefined, column: undefined };
  }
  const linePos = (cause as { linePos?: unknown }).linePos;
  if (!Array.isArray(linePos) || linePos.length === 0) {
    return { line: undefined, column: undefined };
  }
  const first = linePos[0] as { line?: unknown; col?: unknown } | undefined;
  const line =
    typeof first?.line === "number" &&
    Number.isInteger(first.line) &&
    first.line > 0
      ? first.line
      : undefined;
  const column =
    typeof first?.col === "number" &&
    Number.isInteger(first.col) &&
    first.col > 0
      ? first.col
      : undefined;
  return { line, column };
}

/** 将 YAML parser 错误收敛为固定类别，不读取或返回源文本。 */
export function yamlErrorCategory(cause: unknown): string {
  const code =
    typeof cause === "object" && cause !== null
      ? (cause as { code?: unknown }).code
      : undefined;
  return code === "DUPLICATE_KEY" ? "重复 YAML key" : "YAML 解析失败";
}
