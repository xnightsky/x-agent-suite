/**
 * @module @x-agent-suite/criteria/tool-call
 * 工具调用核对判据：期望工具被调用且 completed、action 与入参子集匹配。
 * 不变量：
 * - 断言只落在 ToolCall.status 与结构化入参上，不看退出码与文本；
 * - expect 形状非法显式抛错（配置错误不等于评测失败）。
 */

import type {
  CriterionResult,
  ToolCall,
  TurnCriterion,
} from "@x-agent-suite/contracts";
import { toolActionMatches, toolNameMatches } from "@x-agent-suite/observation";

/** tool-call 判据的 expect 形状。 */
export interface ToolCallExpect {
  /** 期望被调用的工具裸名（按末段匹配，兼容命名空间前缀）。 */
  readonly tool: string;
  /** 单工具 action 分派形态下的 action 期望。 */
  readonly action?: string;
  /** 入参子集约束：每个键值对必须出现在该次调用的 input 中（递归 JSON 相等）。 */
  readonly args?: Record<string, unknown>;
}

/** 校验 expect 形状；非法显式抛错。 */
function asToolCallExpect(expect: unknown): ToolCallExpect {
  if (
    typeof expect !== "object" ||
    expect === null ||
    typeof (expect as ToolCallExpect).tool !== "string" ||
    (expect as ToolCallExpect).tool.length === 0
  ) {
    throw new TypeError(
      `tool-call 的 expect 必须是含非空 tool 字段的对象，实际：${JSON.stringify(expect)}`,
    );
  }
  return expect as ToolCallExpect;
}

/** 递归子集匹配：subset 的每个键值都在 target 中（对象递归，其余 JSON 相等）。 */
function inputContains(
  target: unknown,
  subset: Record<string, unknown>,
): boolean {
  if (typeof target !== "object" || target === null) return false;
  const record = target as Record<string, unknown>;
  return Object.entries(subset).every(([key, value]) => {
    const actual = record[key];
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return inputContains(actual, value as Record<string, unknown>);
    }
    return JSON.stringify(actual) === JSON.stringify(value);
  });
}

/** 逐次调用分类判定：名称 → action → args → status。 */
function judgeCalls(
  calls: readonly ToolCall[],
  expect: ToolCallExpect,
): CriterionResult {
  const named = calls.filter((call) => toolNameMatches(call, expect.tool));
  if (named.length === 0) {
    return { pass: false, score: 0, reason: `未调用工具 "${expect.tool}"` };
  }
  const acted = expect.action
    ? named.filter((call) => toolActionMatches(call, expect.action!))
    : named;
  if (acted.length === 0) {
    return {
      pass: false,
      score: 0,
      reason: `工具 "${expect.tool}" 未以 action "${expect.action}" 调用`,
    };
  }
  const matched = expect.args
    ? acted.filter((call) => inputContains(call.input, expect.args!))
    : acted;
  if (matched.length === 0) {
    return {
      pass: false,
      score: 0,
      reason: `工具 "${expect.tool}" 入参不匹配期望子集`,
    };
  }
  const completed = matched.find((call) => call.status === "completed");
  return completed
    ? { pass: true, score: 1, reason: `工具 "${expect.tool}" 调用成功` }
    : {
        pass: false,
        score: 0,
        reason: `工具 "${expect.tool}" 被调用但无一 completed`,
      };
}

/**
 * 工具调用核对判据。
 * expect：`{ tool, action?, args? }`（见 {@link ToolCallExpect}）。
 */
export const toolCall: TurnCriterion = {
  name: "tool-call",
  scope: "turn",
  evaluate(turn, context): CriterionResult {
    return judgeCalls(turn.toolCalls, asToolCallExpect(context.expect));
  },
};
