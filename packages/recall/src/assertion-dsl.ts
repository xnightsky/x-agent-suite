/**
 * @module @x-agent-suite/recall/assertion-dsl
 * turn/case 断言 DSL 与内部 Judge rubric 展开；作者分值不进入 Judge 裁定输入。
 */
import type { ExpectBlock } from "@x-agent-suite/contracts";
import {
  parseAssertionScore,
  type AssertionScoreConfig,
} from "@x-agent-suite/assertions";
import {
  assertKnownFields,
  isNonEmptyString,
  isPositiveInteger,
  isRecord,
  requiredString,
} from "./validation.ts";

/** Recall 作者分值声明；通用形状与校验归 @x-agent-suite/assertions。 */
export type RecallAssertionScore = AssertionScoreConfig;

/** 一个 AI rubric 的作者声明。 */
export interface RecallJudgeRubricDefinition {
  readonly rubric: string;
  readonly score?: RecallAssertionScore;
}

/** turn/case 内置 Judge 配置；简写与完整形态统一归一为 rubrics + 执行参数。 */
export interface RecallJudgeDefinition {
  readonly rubrics: Readonly<Record<string, RecallJudgeRubricDefinition>>;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly instructions?: string;
}

/** 校验后的 case expect；机械值保持原始引用，judge 为内置归一配置。 */
export type RecallCaseExpectDefinition = Record<string, unknown> & {
  readonly judge?: RecallJudgeDefinition;
};

/** case expect 编译结果：Runner 输入与 Recall 私有 Judge 元数据。 */
export interface CompiledRecallCaseExpect {
  readonly expect?: ExpectBlock;
  readonly judge?: RecallJudgeDefinition;
}

function schemaError(filePath: string, message: string): Error {
  return new Error("Recall 考卷无效：" + message + "（" + filePath + "）");
}
function assertFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  filePath: string,
  at: string,
): void {
  try {
    assertKnownFields(value, allowed, at);
  } catch (cause) {
    throw schemaError(filePath, (cause as Error).message);
  }
}

function parseScore(value: unknown, filePath: string, at: string) {
  if (value === undefined) return undefined;
  try {
    return parseAssertionScore(value, at);
  } catch (cause) {
    throw schemaError(filePath, (cause as Error).message);
  }
}

function parseRubric(
  value: unknown,
  filePath: string,
  at: string,
): RecallJudgeRubricDefinition {
  if (!isRecord(value)) throw schemaError(filePath, at + " 必须是对象");
  assertFields(value, ["rubric", "score"], filePath, at);
  const score = parseScore(value.score, filePath, at + ".score");
  return {
    rubric: requiredString(value.rubric, at + ".rubric"),
    ...(score ? { score } : {}),
  };
}

function parseRubrics(
  value: unknown,
  filePath: string,
  at: string,
): Readonly<Record<string, RecallJudgeRubricDefinition>> {
  if (!isRecord(value)) throw schemaError(filePath, at + " 必须是对象");
  const rubrics: [string, RecallJudgeRubricDefinition][] = [];
  for (const [name, rubric] of Object.entries(value)) {
    if (!isNonEmptyString(name) || name.includes(".")) {
      throw schemaError(filePath, at + " rubric 名必须非空且不含点号");
    }
    rubrics.push([name, parseRubric(rubric, filePath, at + "." + name)]);
  }
  if (rubrics.length === 0) {
    throw schemaError(filePath, at + " 至少声明一项 rubric");
  }
  return Object.fromEntries(rubrics);
}

function parseJudge(
  value: unknown,
  filePath: string,
  at: string,
): RecallJudgeDefinition {
  if (!isRecord(value)) throw schemaError(filePath, at + " 必须是对象");
  const reserved = ["rubrics", "timeoutMs", "maxRetries", "instructions"];
  const full = reserved.some((key) => Object.hasOwn(value, key));
  if (!full) return { rubrics: parseRubrics(value, filePath, at) };
  assertFields(value, reserved, filePath, at);
  if (value.timeoutMs !== undefined && !isPositiveInteger(value.timeoutMs)) {
    throw schemaError(filePath, at + ".timeoutMs 必须是正整数");
  }
  if (
    value.maxRetries !== undefined &&
    (!Number.isInteger(value.maxRetries) || (value.maxRetries as number) < 0)
  ) {
    throw schemaError(filePath, at + ".maxRetries 必须是非负整数");
  }
  const instructions =
    value.instructions === undefined
      ? undefined
      : requiredString(value.instructions, at + ".instructions");
  return {
    rubrics: parseRubrics(value.rubrics, filePath, at + ".rubrics"),
    ...(value.timeoutMs !== undefined
      ? { timeoutMs: value.timeoutMs as number }
      : {}),
    ...(value.maxRetries !== undefined
      ? { maxRetries: value.maxRetries as number }
      : {}),
    ...(instructions !== undefined ? { instructions } : {}),
  };
}

/** 解析 turn/case expect；机械判据声明不包装、不改写。 */
export function parseRecallCaseExpect(
  value: unknown,
  filePath: string,
  at: string,
): RecallCaseExpectDefinition | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw schemaError(filePath, at + " 必须是对象");
  if (Object.hasOwn(value, "decision")) {
    throw schemaError(filePath, at + ".decision 不属于一期 Recall DSL");
  }
  return {
    ...value,
    ...(value.judge !== undefined
      ? { judge: parseJudge(value.judge, filePath, at + ".judge") }
      : {}),
  } as RecallCaseExpectDefinition;
}

/** 生成 Recall 内部 rubric 判据键，避免与消费者机械判据争名。 */
export function recallJudgeCriterionName(name: string): string {
  return "__recall_judge__:" + name;
}

/** 将 turn/case expect 展开为 Runner 可调度形状，并保留私有 Judge 元数据。 */
export function compileRecallCaseExpect(
  definition: RecallCaseExpectDefinition | undefined,
): CompiledRecallCaseExpect {
  if (!definition) return {};
  const entries: [string, unknown][] = [];
  for (const [name, value] of Object.entries(definition)) {
    if (name !== "judge") {
      entries.push([name, value]);
      continue;
    }
    for (const [rubricName, rubric] of Object.entries(
      definition.judge!.rubrics,
    )) {
      entries.push([recallJudgeCriterionName(rubricName), rubric]);
    }
  }
  const expect = Object.fromEntries(entries);
  return {
    ...(entries.length > 0 ? { expect } : {}),
    ...(definition.judge ? { judge: definition.judge } : {}),
  };
}
