/**
 * @module @x-agent-suite/llm-fixture/yaml-error
 * YAML parser 错误的安全位置提取：只保留行列，不复制 error.message 或源行。
 */

/**
 * 从 YAML parser 错误中提取首个安全的行、列位置。
 *
 * @param error parser 抛出的未知错误。
 * @returns 正整数行列；无法可靠提取时返回 undefined。
 */
export function yamlErrorPosition(
  error: unknown,
): { readonly line: number; readonly column: number } | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const linePos = (error as { readonly linePos?: unknown }).linePos;
  if (!Array.isArray(linePos) || linePos.length === 0) return undefined;
  const first = linePos[0];
  if (typeof first !== "object" || first === null) return undefined;
  const line = (first as { readonly line?: unknown }).line;
  const column = (first as { readonly col?: unknown }).col;
  if (
    typeof line !== "number" ||
    !Number.isInteger(line) ||
    line <= 0 ||
    typeof column !== "number" ||
    !Number.isInteger(column) ||
    column <= 0
  ) {
    return undefined;
  }
  return { line, column };
}
