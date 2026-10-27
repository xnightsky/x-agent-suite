/**
 * @module @x-agent-suite/recall/schema
 * Recall YAML v1 严格 Schema；未知字段与空定义一律拒绝。
 */
import { parse } from "yaml";
import { isNonEmptyString, isPositiveInteger, isRecord } from "./config.ts";

/** 已校验的 Recall 考卷。 */
export interface RecallDefinition {
  readonly id: string;
  readonly context?: { readonly files?: readonly string[] };
  readonly cases: readonly RecallCaseDefinition[];
}

/** 已校验的 case 定义。 */
export interface RecallCaseDefinition {
  readonly id: string;
  readonly turns: readonly RecallTurnDefinition[];
  readonly timeoutMs?: number;
  readonly metadata?: Record<string, unknown>;
}

/** 已校验的 turn 定义。 */
export interface RecallTurnDefinition {
  readonly send: string;
  readonly expect?: Record<string, unknown>;
  readonly timeoutMs?: number;
}

/** 解析并完整校验一份 YAML；不兼容外部 Schema。 */
export function parseRecallYaml(
  source: string,
  filePath: string,
): RecallDefinition {
  let value: unknown;
  try {
    value = parse(source, { strict: true, uniqueKeys: true });
  } catch (cause) {
    throw new Error("Recall YAML 解析失败：" + filePath, { cause });
  }
  if (!isRecord(value)) throw schemaError(filePath, "顶层必须是对象");
  assertFields(value, ["version", "id", "context", "cases"], filePath, "顶层");
  if (value.version !== 1) throw schemaError(filePath, "version 必须为 1");
  const id = requiredId(value.id, filePath, "顶层 id");
  if (!Array.isArray(value.cases) || value.cases.length === 0) {
    throw schemaError(filePath, "cases 必须是非空数组");
  }
  const context = parseContext(value.context, filePath);
  const cases = value.cases.map((item, index) =>
    parseCase(item, filePath, index),
  );
  return { id, ...(context ? { context } : {}), cases };
}

function parseContext(value: unknown, filePath: string) {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw schemaError(filePath, "context 必须是对象");
  assertFields(value, ["files"], filePath, "context");
  if (value.files === undefined) return {};
  if (!Array.isArray(value.files) || !value.files.every(isNonEmptyString)) {
    throw schemaError(filePath, "context.files 必须是非空路径字符串数组");
  }
  return { files: value.files as string[] };
}

function parseCase(
  value: unknown,
  filePath: string,
  index: number,
): RecallCaseDefinition {
  const at = "cases[" + index + "]";
  if (!isRecord(value)) throw schemaError(filePath, at + " 必须是对象");
  assertFields(value, ["id", "turns", "timeoutMs", "metadata"], filePath, at);
  const id = requiredId(value.id, filePath, at + ".id");
  if (!Array.isArray(value.turns) || value.turns.length === 0) {
    throw schemaError(filePath, at + ".turns 必须是非空数组");
  }
  const timeoutMs = optionalTimeout(value.timeoutMs, filePath, at);
  if (value.metadata !== undefined && !isRecord(value.metadata)) {
    throw schemaError(filePath, at + ".metadata 必须是对象");
  }
  const turns = value.turns.map((turn, turnIndex) =>
    parseTurn(turn, filePath, at, turnIndex),
  );
  return {
    id,
    turns,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(value.metadata !== undefined
      ? { metadata: value.metadata as Record<string, unknown> }
      : {}),
  };
}

function parseTurn(
  value: unknown,
  filePath: string,
  caseAt: string,
  index: number,
): RecallTurnDefinition {
  const at = caseAt + ".turns[" + index + "]";
  if (!isRecord(value)) throw schemaError(filePath, at + " 必须是对象");
  assertFields(value, ["send", "expect", "timeoutMs"], filePath, at);
  if (typeof value.send !== "string" || value.send.length === 0) {
    throw schemaError(filePath, at + ".send 不得为空字符串");
  }
  if (value.expect !== undefined && !isRecord(value.expect)) {
    throw schemaError(filePath, at + ".expect 必须是对象");
  }
  const timeoutMs = optionalTimeout(value.timeoutMs, filePath, at);
  return {
    send: value.send,
    ...(value.expect !== undefined
      ? { expect: value.expect as Record<string, unknown> }
      : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  };
}

function optionalTimeout(value: unknown, filePath: string, at: string) {
  if (value !== undefined && !isPositiveInteger(value)) {
    throw schemaError(filePath, at + ".timeoutMs 必须是正整数");
  }
  return value as number | undefined;
}

function requiredId(value: unknown, filePath: string, at: string): string {
  if (!isNonEmptyString(value)) throw schemaError(filePath, at + " 必须非空");
  return value;
}

function assertFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  filePath: string,
  at: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw schemaError(filePath, at + " 含未知字段 " + key);
    }
  }
}

function schemaError(filePath: string, message: string): Error {
  return new Error("Recall 考卷无效：" + message + "（" + filePath + "）");
}
