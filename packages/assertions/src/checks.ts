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

export type { EnumerateCheck, EnumerateResult, HardExpectation };

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
 * action 归一判定：ToolCall.input 为对象且 action 字段精确相等。
 * @param call 一次工具调用记录。
 * @param action 期望的单工具 action。
 */
export function toolActionMatches(call: ToolCall, action: string): boolean {
  const input = call.input;
  return (
    typeof input === "object" &&
    input !== null &&
    (input as Record<string, unknown>).action === action
  );
}

/**
 * dry contract 层：Observation 结构合法性（driver 产出是否可信的最低门槛）。
 * @param observation 单轮观测。
 * @returns 失败原因列表；空数组 = 通过。
 */
export function dryChecks(observation: Observation): string[] {
  const failures: string[] = [];
  if (!Array.isArray(observation.events) || observation.events.length === 0) {
    failures.push("events 为空：driver 未产出任何底层事件");
  }
  if (!Array.isArray(observation.toolCalls)) {
    failures.push("toolCalls 不是数组");
    return failures;
  }
  if (observation.toolCallsCount !== observation.toolCalls.length) {
    failures.push(
      `toolCallsCount=${observation.toolCallsCount} 与 toolCalls.length=${observation.toolCalls.length} 不一致`,
    );
  }
  for (const call of observation.toolCalls) {
    if (!call.name) {
      failures.push("存在缺少 name 的 ToolCall");
    }
    if (call.status !== "completed" && call.status !== "failed") {
      failures.push(
        `ToolCall(${call.name}) status 非法: ${JSON.stringify(call.status)}`,
      );
    }
  }
  return failures;
}

/** 浅层入参匹配：input 必须是对象，且每个期望键的值 JSON 相等。 */
function argsMatch(input: unknown, expected: Record<string, unknown>): boolean {
  if (typeof input !== "object" || input === null) {
    return false;
  }
  const record = input as Record<string, unknown>;
  return Object.entries(expected).every(
    ([key, value]) =>
      key in record && JSON.stringify(record[key]) === JSON.stringify(value),
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
  const label =
    expected.action === undefined
      ? expected.tool
      : `${expected.tool}(action=${expected.action})`;
  const calls = observation.toolCalls.filter(
    (c) =>
      toolNameMatches(c, expected.tool) &&
      (expected.action === undefined || toolActionMatches(c, expected.action)),
  );
  if (calls.length === 0) {
    return [`未调用 ${label}`];
  }
  const completed = calls.filter((c) => c.status === "completed");
  if (completed.length === 0) {
    return [
      `${label} 调用未成功完成（status 均非 completed）: ` +
        JSON.stringify(calls.map((c) => ({ name: c.name, status: c.status }))),
    ];
  }
  if (!expected.args) {
    return [];
  }
  const matched = completed.some((c) =>
    argsMatch(c.input, expected.args ?? {}),
  );
  if (!matched) {
    return [
      `${label} 入参不匹配，期望包含 ${JSON.stringify(expected.args)}；` +
        `实际: ${JSON.stringify(completed.map((c) => c.input ?? null))}`,
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
