import type { JudgeRubric, JudgeVerdict } from "./types.ts";
import { JudgeModelError } from "./types.ts";

/** 一次响应的逐项解析结果。 */
export interface ParsedJudgeResponse {
  /** 明确识别的裁定。 */
  readonly verdicts: readonly JudgeVerdict[];
  /** 缺失或无法识别的 rubric 名称。 */
  readonly absent: readonly string[];
}

/** 提取第一个括号平衡的 JSON object；字符串内 braces 不参与配平。 */
function extractJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return undefined;
}

/** 解析整体 JSON object；失败时不携带响应原文。 */
function parseObject(text: string): Record<string, unknown> {
  const source = extractJsonObject(text);
  if (!source) throw new JudgeModelError("parse", "Judge 响应不含 JSON object");
  try {
    const value: unknown = JSON.parse(source);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new JudgeModelError("parse", "Judge 响应根必须是 object");
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof JudgeModelError) throw error;
    throw new JudgeModelError("parse", "Judge 响应 JSON 无法解析", {
      cause: error,
    });
  }
}

/** 把单个响应值解析为布尔 pass；无法识别返回 undefined。 */
function parsePass(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && /^(true|yes|pass|y)$/i.test(value.trim())) {
    return true;
  }
  return undefined;
}

/** 按输入 rubric 顺序解析 verdict 与 absent；额外键和分数字段一律忽略。 */
export function parseJudgeResponse(
  text: string,
  rubrics: readonly JudgeRubric[],
): ParsedJudgeResponse {
  const value = parseObject(text);
  const verdicts: JudgeVerdict[] = [];
  const absent: string[] = [];
  for (const rubric of rubrics) {
    const entry = value[rubric.name];
    const simple = typeof entry === "boolean" || typeof entry === "string";
    const pass = simple
      ? parsePass(entry)
      : typeof entry === "object" && entry !== null && !Array.isArray(entry)
        ? parsePass((entry as Record<string, unknown>).pass)
        : undefined;
    if (pass === undefined) {
      absent.push(rubric.name);
      continue;
    }
    const reason =
      !simple &&
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as Record<string, unknown>).reason === "string"
        ? ((entry as Record<string, unknown>).reason as string)
        : "";
    verdicts.push({ name: rubric.name, pass, reason });
  }
  return { verdicts, absent };
}
