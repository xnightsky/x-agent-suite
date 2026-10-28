/**
 * @module @x-agent-suite/assertions/deterministic
 * 确定性判据：文本包含（AND）、红线排除与工具调用核对。
 * 不变量：
 * - expect 形状非法显式抛错（配置错误不等于评测失败）；
 * - 工具断言只落在 ToolCall.status 与结构化入参上，不看退出码与文本；
 * - tool-call 的 args 是递归子集约束，浅层 JSON 相等只用于检查层的 hardChecks。
 */
import type {
  CriterionResult,
  ToolCall,
  TurnCriterion,
} from "@x-agent-suite/contracts";
import { toolActionMatches, toolNameMatches } from "./checks.ts";

/** tool-call 判据的 expect 形状。 */
export interface ToolCallExpect {
  /** 期望被调用的工具裸名（按末段匹配，兼容命名空间前缀）。 */
  readonly tool: string;
  /** 单工具 action 分派形态下的 action 期望。 */
  readonly action?: string;
  /** 入参子集约束：每个键值对必须出现在该次调用的 input 中（递归 JSON 相等）。 */
  readonly args?: Record<string, unknown>;
}

/**
 * 校验并归一 expect 为字符串列表。
 * @param expect 判据 expect 原值。
 * @param criterionName 用于错误信息的判据名。
 * @throws TypeError expect 不是非空字符串或非空字符串数组时抛出。
 */
function asExpectList(
  expect: unknown,
  criterionName: string,
): readonly string[] {
  const list = typeof expect === "string" ? [expect] : expect;
  if (
    !Array.isArray(list) ||
    list.length === 0 ||
    !list.every((item) => typeof item === "string" && item.length > 0)
  ) {
    throw new TypeError(
      `${criterionName} 的 expect 必须是非空字符串或非空字符串数组，实际：${JSON.stringify(expect)}`,
    );
  }
  return list as readonly string[];
}

/**
 * 校验 tool-call 的 expect 形状。
 * @param expect 判据 expect 原值。
 * @throws TypeError expect 不是含非空 tool 字段的对象时抛出。
 */
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
 * 文本包含判据（AND 语义）：expect 列出的文本全部出现才通过。
 * expect：`string | string[]`。
 */
export const textContains: TurnCriterion = {
  name: "text-contains",
  scope: "turn",
  evaluate(turn, context): CriterionResult {
    const expected = asExpectList(context.expect, "text-contains");
    const missing = expected.filter((keyword) => !turn.text.includes(keyword));
    return missing.length === 0
      ? { pass: true, score: 1, reason: `全部 ${expected.length} 个关键词命中` }
      : { pass: false, score: 0, reason: `缺少关键词：${missing.join("、")}` };
  },
};

/**
 * 红线排除判据：expect 列出的文本任一出现即失败。
 * expect：`string | string[]`。
 */
export const textNotContains: TurnCriterion = {
  name: "text-not-contains",
  scope: "turn",
  evaluate(turn, context): CriterionResult {
    const redLines = asExpectList(context.expect, "text-not-contains");
    const hits = redLines.filter((keyword) => turn.text.includes(keyword));
    return hits.length === 0
      ? { pass: true, score: 1, reason: "红线均未出现" }
      : { pass: false, score: 0, reason: `命中红线：${hits.join("、")}` };
  },
};

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
