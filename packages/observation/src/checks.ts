/**
 * @module @x-agent-suite/observation/checks
 * 评分层四层检查：dry / hard / fuzzy / enumerate。
 * 不变量：
 * - dry + hard 为默认门禁，fuzzy 兜底；
 * - hard 断言只落在 ToolCall.status 与结构化入参上，不看退出码与末条文本；
 * - enumerate 逐条核对（幻觉/遗漏），不靠「某条在不在」的正则。
 */
import type {
  HardExpectation,
  Observation,
  ToolCall,
} from "@x-agent-suite/contracts";
import type { EnumerateCheck, EnumerateResult } from "@x-agent-suite/contracts";

export type {
  EnumerateCheck,
  EnumerateResult,
  HardExpectation,
} from "@x-agent-suite/contracts";

/** 工具名归一判定：末段匹配，兼容命名空间前缀。 */
export function toolNameMatches(call: ToolCall, tool: string): boolean {
  return (
    call.name === tool ||
    call.name.endsWith(`__${tool}`) ||
    call.name.endsWith(`_${tool}`)
  );
}

/** action 归一判定：ToolCall.input 为对象且 action 字段精确相等。 */
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
 * 返回失败原因列表；空数组 = 通过。
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

/**
 * hard 层：期望工具被调用、status==="completed"、入参满足约束。
 * 指定 action 时先按 input.action 过滤（单工具 action 分派形态）。
 * 返回失败原因列表；空数组 = 通过。
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
 * fuzzy 层：文本兜底匹配（字符串包含 / 正则命中任一即算该项通过）。
 * 返回未命中的 pattern 描述列表；空数组 = 通过。
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
 * hallucinated = 列出但不存在；missing = 存在但没列出（requireComplete=true 时）。
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
