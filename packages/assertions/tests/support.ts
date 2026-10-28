/**
 * @module @x-agent-suite/assertions/tests/support
 * 测试夹具：最小合法 Observation 形状与同步求值助手。
 * 不变量：本文件不是测试入口，只提供夹具。
 */
import type {
  Observation,
  SessionObservation,
  ToolCall,
  TurnCriterion,
  TurnCriterionContext,
  TurnObservation,
} from "@x-agent-suite/contracts";

/** 构造一轮观测。 */
export function makeTurn(
  text: string,
  toolCalls: ToolCall[] = [],
): TurnObservation {
  return {
    index: 0,
    sent: "题面",
    text,
    toolCalls,
    commands: [],
    startedAt: 0,
    endedAt: 1,
    metadata: {},
  };
}

/** 构造 turn 判据上下文（session 给最小合法形状）。 */
export function makeContext(expect: unknown): TurnCriterionContext {
  const session: SessionObservation = {
    driver: "mock",
    turns: [],
    text: "",
    toolCalls: [],
    commands: [],
    exhausted: false,
    metadata: {},
  };
  return { turnIndex: 0, session, expect };
}

/** 构造单轮 Observation；toolCallsCount 由 toolCalls 推导。 */
export function makeObservation(
  text: string,
  toolCalls: ToolCall[] = [],
  events: Observation["events"] = [{ type: "text", timestamp: 0 }],
): Observation {
  return {
    text,
    toolCalls,
    toolCallsCount: toolCalls.length,
    events,
  };
}

/** 同步求值判据；异步实现视为实现错误。 */
export function evaluateSync(
  criterion: TurnCriterion,
  turn: TurnObservation,
  context: TurnCriterionContext,
) {
  const result = criterion.evaluate(turn, context);
  if (result instanceof Promise) throw new Error("判据应为同步实现");
  return result;
}
