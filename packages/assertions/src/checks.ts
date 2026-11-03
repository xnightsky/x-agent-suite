/**
 * @module @x-agent-suite/assertions/checks
 * 检查层四层原语：dry / hard / fuzzy / enumerate，以及工具调用匹配判定。
 * 不变量：
 * - dry + hard 为默认门禁，fuzzy 兜底；
 * - hard 断言只落在 ToolCall.status 与结构化入参上，不看退出码与末条文本；
 * - hard 的 args 为浅层 JSON 相等；enumerate 逐条核对，不靠「某条在不在」的正则；
 * - fuzzy 的多个 pattern 是 AND：每个 pattern 都必须命中。
 */
import type {
  EnumerateCheck,
  EnumerateResult,
  HardExpectation,
  Observation,
  ToolCall,
} from "@x-agent-suite/contracts";
import {
  assertJsonValue,
  isJsonObject,
  isJsonValue,
  jsonEqual,
  type JsonObject,
} from "./json-safe.ts";

export type { EnumerateCheck, EnumerateResult, HardExpectation };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function displayJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return "<无法序列化的值>";
  }
}

/**
 * 工具名归一判定：末段匹配，兼容命名空间前缀。
 * @param call 一次工具调用记录。
 * @param tool 期望的工具裸名。
 * @returns 调用名等于裸名、或以 __ / _ 加裸名结尾时为 true。
 */
export function toolNameMatches(call: ToolCall, tool: string): boolean {
  return (
    call.name === tool ||
    call.name.endsWith(`__${tool}`) ||
    call.name.endsWith(`_${tool}`)
  );
}

/**
 * action 归一判定：ToolCall.input 为对象且自有 action 字段精确相等。
 * @param call 一次工具调用记录。
 * @param action 期望的单工具 action。
 */
export function toolActionMatches(call: ToolCall, action: string): boolean {
  const input = call.input;
  return (
    typeof input === "object" &&
    input !== null &&
    Array.isArray(input) === false &&
    Object.hasOwn(input, "action") &&
    (input as Record<string, unknown>).action === action
  );
}

/**
 * dry contract 层：Observation 结构合法性（driver 产出是否可信的最低门槛）。
 * @param observation 单轮观测。
 * @returns 失败原因列表；空数组 = 通过。
 */
export function dryChecks(observation: Observation): string[] {
  if (!isRecord(observation)) return ["observation 不是对象"];
  const failures: string[] = [];

  if (typeof observation.text !== "string") {
    failures.push("observation.text 必须是字符串");
  }

  const events = observation.events;
  if (!Array.isArray(events) || events.length === 0) {
    failures.push("events 为空：driver 未产出任何底层事件");
  } else {
    for (const [index, event] of events.entries()) {
      if (!isRecord(event)) {
        failures.push(`events[${index}] 必须是对象`);
        continue;
      }
      if (!isNonEmptyString(event.type)) {
        failures.push(`events[${index}].type 必须是非空字符串`);
      }
      if (
        typeof event.timestamp !== "number" ||
        !Number.isFinite(event.timestamp)
      ) {
        failures.push(`events[${index}].timestamp 必须是有限数`);
      }
    }
  }

  const toolCalls = observation.toolCalls;
  const countValid = isNonNegativeInteger(observation.toolCallsCount);
  if (!countValid) {
    failures.push("toolCallsCount 必须是非负整数");
  }
  if (!Array.isArray(toolCalls)) {
    failures.push("toolCalls 不是数组");
    return failures;
  }
  if (countValid && observation.toolCallsCount !== toolCalls.length) {
    failures.push(
      `toolCallsCount=${observation.toolCallsCount} 与 toolCalls.length=${toolCalls.length} 不一致`,
    );
  }
  for (const [index, call] of toolCalls.entries()) {
    if (!isRecord(call)) {
      failures.push(`toolCalls[${index}] 必须是对象`);
      continue;
    }
    if (!isNonEmptyString(call.name)) {
      failures.push(`toolCalls[${index}].name 必须是非空字符串`);
    }
    if (!Object.hasOwn(call, "input")) {
      failures.push(`toolCalls[${index}] 缺少 input`);
    }
    if (call.status !== "completed" && call.status !== "failed") {
      failures.push(
        `ToolCall(${String(call.name)}) status 非法: ${displayJson(call.status)}`,
      );
    }
  }

  if (
    observation.steps !== undefined &&
    !isNonNegativeInteger(observation.steps)
  ) {
    failures.push("steps 必须是非负整数");
  }
  if (
    observation.exhausted !== undefined &&
    typeof observation.exhausted !== "boolean"
  ) {
    failures.push("exhausted 必须是 boolean");
  }
  if (observation.usage !== undefined) {
    if (!isRecord(observation.usage)) {
      failures.push("usage 必须是对象");
    } else {
      for (const key of [
        "promptTokens",
        "completionTokens",
        "totalTokens",
      ] as const) {
        if (!isNonNegativeInteger(observation.usage[key])) {
          failures.push(`usage.${key} 必须是非负整数`);
        }
      }
    }
  }
  return failures;
}

/** 校验 hardChecks 的封闭期望形状。 */
function asHardExpectation(value: unknown): HardExpectation {
  if (!isRecord(value)) {
    throw new TypeError("hardChecks 的 expected 必须是对象");
  }
  for (const key of Object.keys(value)) {
    if (key !== "tool" && key !== "action" && key !== "args") {
      throw new TypeError("hardChecks 的 expected 含未知字段 " + key);
    }
  }
  if (!isNonEmptyString(value.tool)) {
    throw new TypeError("hardChecks 的 expected.tool 必须是非空字符串");
  }
  if (value.action !== undefined && !isNonEmptyString(value.action)) {
    throw new TypeError("hardChecks 的 expected.action 必须是非空字符串");
  }
  if (value.args !== undefined && !isJsonObject(value.args)) {
    throw new TypeError("hardChecks 的 expected.args 必须是普通对象");
  }
  if (value.args !== undefined) {
    assertJsonValue(value.args, "hardChecks 的 expected.args");
  }
  return value as unknown as HardExpectation;
}

/** 浅层入参匹配：input 必须是普通对象，且每个期望键的值 JSON 相等。 */
function argsMatch(input: unknown, expected: JsonObject): boolean {
  if (!isJsonValue(input) || !isJsonObject(input)) return false;
  return Object.entries(expected).every(
    ([key, value]) =>
      Object.hasOwn(input, key) && jsonEqual(input[key]!, value),
  );
}

/**
 * hard 层：期望工具被调用、status==="completed"、入参满足约束。
 * 指定 action 时先按 input.action 过滤（单工具 action 分派形态）。
 * @param observation 单轮观测。
 * @param expected 工具、可选 action 与入参约束。
 * @returns 失败原因列表；空数组 = 通过。
 */
export function hardChecks(
  observation: Observation,
  expected: HardExpectation,
): string[] {
  const validated = asHardExpectation(expected);
  const label =
    validated.action === undefined
      ? validated.tool
      : `${validated.tool}(action=${validated.action})`;
  const calls = observation.toolCalls.filter(
    (c) =>
      toolNameMatches(c, validated.tool) &&
      (validated.action === undefined ||
        toolActionMatches(c, validated.action)),
  );
  if (calls.length === 0) {
    return [`未调用 ${label}`];
  }
  const completed = calls.filter((c) => c.status === "completed");
  if (completed.length === 0) {
    return [
      `${label} 调用未成功完成（status 均非 completed）: ` +
        displayJson(calls.map((c) => ({ name: c.name, status: c.status }))),
    ];
  }
  if (validated.args === undefined) {
    return [];
  }
  const matched = completed.some((c) =>
    argsMatch(c.input, validated.args as JsonObject),
  );
  if (!matched) {
    return [
      `${label} 入参不匹配，期望包含 ${displayJson(validated.args)}；` +
        `实际: ${displayJson(completed.map((c) => c.input ?? null))}`,
    ];
  }
  return [];
}

/**
 * fuzzy 层：文本兜底匹配；每个 pattern 都必须命中（AND）。
 * 字符串按包含匹配，RegExp 按 source + flags 重新构造后匹配。
 * @param text 待匹配文本。
 * @param patterns 模式列表。
 * @returns 未命中的 pattern 描述列表；空数组 = 通过。
 */
export function fuzzyChecks(
  text: string,
  patterns: readonly (string | RegExp)[],
): string[] {
  const failures: string[] = [];
  for (const pattern of patterns) {
    const hit =
      typeof pattern === "string"
        ? text.includes(pattern)
        : new RegExp(pattern.source, pattern.flags).test(text);
    if (!hit) {
      failures.push(`文本未命中 fuzzy 模式: ${String(pattern)}`);
    }
  }
  return failures;
}

/**
 * 列举类核对：把模型列出的每一条 id 与真实状态逐一比对。
 * @param text 模型输出文本。
 * @param expectedIds 真实存在的 id。
 * @param check 抽取正则与是否要求完整。
 * @returns hallucinated = 列出但不存在；missing = 存在但没列出（requireComplete=true 时）。
 */
export function checkListResult(
  text: string,
  expectedIds: readonly string[],
  check: EnumerateCheck,
): EnumerateResult {
  const listed = [...text.matchAll(check.extract)].map((m) => m[0]);
  const listedUnique = [...new Set(listed)];
  const expectedSet = new Set(expectedIds);
  return {
    hallucinated: listedUnique.filter((id) => !expectedSet.has(id)),
    missing: check.requireComplete
      ? expectedIds.filter((id) => !listedUnique.includes(id))
      : [],
  };
}
