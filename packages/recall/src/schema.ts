/**
 * @module @x-agent-suite/recall/schema
 * Recall YAML v1：cases、文件内 plans 与全局/case context 的严格 Schema。
 * 不变量：context.plan 只引用当前文档 plans；plan/files 互斥，case context 整块覆盖。
 */
import { posix } from "node:path";
import { parse } from "yaml";
import {
  assertKnownFields,
  isNonEmptyString,
  isPositiveInteger,
  isRecord,
  requiredString,
} from "./validation.ts";

/** 场景资源类别。 */
export type RecallResourceKind = "file" | "directory";

/** Recall YAML 内一条资源声明。 */
export interface RecallResourceDefinition {
  readonly source: string;
  readonly destination: string;
  readonly kind: RecallResourceKind;
  readonly readOnly: true;
}

/** 文件内命名 ProvisionPlan。 */
export interface RecallProvisionPlanDefinition {
  readonly resources: readonly RecallResourceDefinition[];
}

/** 全局或 case 的 context；files 与 plan 互斥。 */
export interface RecallContextDefinition {
  readonly files?: readonly string[];
  readonly plan?: string;
}

/** 一个 Recall case。 */
export interface RecallCaseDefinition {
  readonly id: string;
  readonly turns: readonly RecallTurnDefinition[];
  readonly timeoutMs?: number;
  readonly metadata?: Record<string, unknown>;
  readonly context?: RecallContextDefinition;
}

/** 单轮声明。 */
export interface RecallTurnDefinition {
  readonly send: string;
  readonly expect?: Record<string, unknown>;
  readonly timeoutMs?: number;
}

/** 已校验的 Recall 文档。 */
export interface RecallDefinition {
  readonly id: string;
  readonly context?: RecallContextDefinition;
  readonly plans?: Readonly<Record<string, RecallProvisionPlanDefinition>>;
  readonly cases: readonly RecallCaseDefinition[];
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

function normalizeDestination(
  value: unknown,
  filePath: string,
  at: string,
): string {
  const raw = requiredString(value, at);
  if (raw.includes("\0") || /^[a-zA-Z]:/.test(raw)) {
    throw schemaError(filePath, at + " 含非法 destination");
  }
  const normalized = posix.normalize(raw.split("\\").join("/"));
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/")
  ) {
    throw schemaError(filePath, at + " destination 逃逸工作区：" + raw);
  }
  return normalized;
}

function parseResource(
  value: unknown,
  filePath: string,
  at: string,
): RecallResourceDefinition {
  if (!isRecord(value)) throw schemaError(filePath, at + " 必须是对象");
  assertFields(
    value,
    ["source", "destination", "kind", "readOnly"],
    filePath,
    at,
  );
  const kind = value.kind ?? "file";
  if (kind !== "file" && kind !== "directory") {
    throw schemaError(filePath, at + ".kind 必须是 file 或 directory");
  }
  if (value.readOnly !== undefined && value.readOnly !== true) {
    throw schemaError(filePath, at + ".readOnly 当前仅支持 true");
  }
  return {
    source: requiredString(value.source, at + ".source"),
    destination: normalizeDestination(
      value.destination,
      filePath,
      at + ".destination",
    ),
    kind,
    readOnly: true,
  };
}

function assertNoDestinationConflicts(
  resources: readonly RecallResourceDefinition[],
  filePath: string,
  plan: string,
): void {
  for (let left = 0; left < resources.length; left += 1) {
    for (let right = left + 1; right < resources.length; right += 1) {
      const a = resources[left]!.destination;
      const b = resources[right]!.destination;
      if (a === b || a.startsWith(b + "/") || b.startsWith(a + "/")) {
        throw schemaError(
          filePath,
          "plans." + plan + " destination 冲突：" + a + " 与 " + b,
        );
      }
    }
  }
}

function parsePlans(value: unknown, filePath: string) {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw schemaError(filePath, "plans 必须是对象");
  const plans: Record<string, RecallProvisionPlanDefinition> = {};
  for (const [name, rawPlan] of Object.entries(value)) {
    if (!isNonEmptyString(name) || name === "none") {
      throw schemaError(filePath, "plans.none 为内置空计划，禁止覆盖");
    }
    if (!isRecord(rawPlan))
      throw schemaError(filePath, "plans." + name + " 必须是对象");
    assertFields(rawPlan, ["resources"], filePath, "plans." + name);
    if (!Array.isArray(rawPlan.resources)) {
      throw schemaError(filePath, "plans." + name + ".resources 必须是数组");
    }
    const resources = rawPlan.resources.map((resource, index) =>
      parseResource(
        resource,
        filePath,
        "plans." + name + ".resources[" + index + "]",
      ),
    );
    assertNoDestinationConflicts(resources, filePath, name);
    plans[name] = { resources };
  }
  return plans;
}

function parseContext(value: unknown, filePath: string, at: string) {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw schemaError(filePath, at + " 必须是对象");
  assertFields(value, ["files", "plan"], filePath, at);
  if (value.files !== undefined && value.plan !== undefined) {
    throw schemaError(filePath, at + ".files 与 plan 互斥");
  }
  if (
    value.files !== undefined &&
    (!Array.isArray(value.files) || !value.files.every(isNonEmptyString))
  ) {
    throw schemaError(filePath, at + ".files 必须是非空字符串路径数组");
  }
  if (value.plan !== undefined && !isNonEmptyString(value.plan)) {
    throw schemaError(filePath, at + ".plan 必须是非空字符串");
  }
  return {
    ...(value.files ? { files: value.files as string[] } : {}),
    ...(value.plan ? { plan: value.plan as string } : {}),
  };
}

function optionalTimeout(value: unknown, filePath: string, at: string) {
  if (value !== undefined && !isPositiveInteger(value)) {
    throw schemaError(filePath, at + ".timeoutMs 必须是正整数");
  }
  return value as number | undefined;
}

function parseTurn(
  value: unknown,
  filePath: string,
  caseAt: string,
  index: number,
) {
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
    ...(value.expect
      ? { expect: value.expect as Record<string, unknown> }
      : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
  };
}

function parseCase(
  value: unknown,
  filePath: string,
  index: number,
): RecallCaseDefinition {
  const at = "cases[" + index + "]";
  if (!isRecord(value)) throw schemaError(filePath, at + " 必须是对象");
  assertFields(
    value,
    ["id", "turns", "timeoutMs", "metadata", "context"],
    filePath,
    at,
  );
  const id = requiredString(value.id, at + ".id");
  if (!Array.isArray(value.turns) || value.turns.length === 0) {
    throw schemaError(filePath, at + ".turns 必须是非空数组");
  }
  if (value.metadata !== undefined && !isRecord(value.metadata)) {
    throw schemaError(filePath, at + ".metadata 必须是对象");
  }
  return {
    id,
    turns: value.turns.map((turn, turnIndex) =>
      parseTurn(turn, filePath, at, turnIndex),
    ),
    ...(value.timeoutMs !== undefined
      ? { timeoutMs: optionalTimeout(value.timeoutMs, filePath, at) }
      : {}),
    ...(value.metadata
      ? { metadata: value.metadata as Record<string, unknown> }
      : {}),
    ...(value.context !== undefined
      ? { context: parseContext(value.context, filePath, at + ".context") }
      : {}),
  };
}

/** 解析并完整校验一份 Recall YAML；不读取其他 YAML 的 plans。 */
export function parseRecallYaml(
  source: string,
  filePath: string,
): RecallDefinition {
  let value: unknown;
  try {
    value = parse(source, { strict: true, uniqueKeys: true });
  } catch (cause) {
    throw schemaError(filePath, "YAML 解析失败：" + String(cause));
  }
  if (!isRecord(value)) throw schemaError(filePath, "顶层必须是对象");
  assertFields(
    value,
    ["version", "id", "context", "plans", "cases"],
    filePath,
    "顶层",
  );
  if (value.version !== 1) throw schemaError(filePath, "version 必须为 1");
  const id = requiredString(value.id, "顶层 id");
  if (!Array.isArray(value.cases) || value.cases.length === 0) {
    throw schemaError(filePath, "cases 必须是非空数组");
  }
  return {
    id,
    ...(value.context !== undefined
      ? { context: parseContext(value.context, filePath, "context") }
      : {}),
    ...(value.plans !== undefined
      ? { plans: parsePlans(value.plans, filePath) }
      : {}),
    cases: value.cases.map((item, index) => parseCase(item, filePath, index)),
  };
}
