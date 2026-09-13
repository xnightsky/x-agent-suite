/**
 * @module @x-agent-suite/criteria/tests/criteria
 * 最小判据集单元测试：text-contains / text-not-contains / tool-call。
 * 不变量：expect 形状非法必须显式抛错（配置错误不等于评测失败）。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  SessionObservation,
  ToolCall,
  TurnCriterion,
  TurnCriterionContext,
  TurnObservation,
} from "@x-agent-suite/contracts";
import { textContains, textNotContains, toolCall } from "../src/index.ts";

/** 同步求值判据（本包判据均为同步实现；若意外返回 Promise 则显式报错）。 */
function evaluateSync(
  criterion: TurnCriterion,
  turn: TurnObservation,
  context: TurnCriterionContext,
) {
  const result = criterion.evaluate(turn, context);
  if (result instanceof Promise) throw new Error("判据应为同步实现");
  return result;
}

/** 构造一轮观测。 */
function makeTurn(text: string, toolCalls: ToolCall[] = []): TurnObservation {
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

/** 构造判据上下文（session 给最小合法形状）。 */
function makeContext(expect: unknown): TurnCriterionContext {
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

// ---------- text-contains ----------

test("text-contains：全部关键词命中通过", () => {
  const result = evaluateSync(
    textContains,
    makeTurn("答案是：不加载，且需要显式声明"),
    makeContext(["不加载", "显式声明"]),
  );
  assert.equal(result.pass, true);
  assert.equal(result.score, 1);
});

test("text-contains：缺关键词判 fail 且 reason 点名缺失项", () => {
  const result = evaluateSync(
    textContains,
    makeTurn("答案是：不加载"),
    makeContext(["不加载", "显式声明"]),
  );
  assert.equal(result.pass, false);
  assert.match(result.reason, /显式声明/);
});

test("text-contains：单字符串 expect 等价单元素数组", () => {
  const result = evaluateSync(
    textContains,
    makeTurn("abc"),
    makeContext("abc"),
  );
  assert.equal(result.pass, true);
});

test("text-contains：expect 形状非法显式抛错", () => {
  assert.throws(
    () => evaluateSync(textContains, makeTurn("abc"), makeContext([])),
    /text-contains.*expect/,
  );
  assert.throws(
    () => evaluateSync(textContains, makeTurn("abc"), makeContext(42)),
    /text-contains.*expect/,
  );
});

// ---------- text-not-contains ----------

test("text-not-contains：红线未出现通过", () => {
  const result = evaluateSync(
    textNotContains,
    makeTurn("答案是：不加载"),
    makeContext(["默认加载", "自动注入"]),
  );
  assert.equal(result.pass, true);
});

test("text-not-contains：红线命中判 fail 且 reason 点名命中项", () => {
  const result = evaluateSync(
    textNotContains,
    makeTurn("默认加载全部提示词"),
    makeContext(["默认加载", "自动注入"]),
  );
  assert.equal(result.pass, false);
  assert.match(result.reason, /默认加载/);
});

// ---------- tool-call ----------

const SEND_CALL: ToolCall = {
  name: "mcp__message__message",
  input: { action: "send", to: "B" },
  status: "completed",
};

test("tool-call：末段名匹配 + completed 通过", () => {
  const result = evaluateSync(
    toolCall,
    makeTurn("已发送", [SEND_CALL]),
    makeContext({ tool: "message", action: "send" }),
  );
  assert.equal(result.pass, true);
});

test("tool-call：从未调用匹配工具判 fail", () => {
  const result = evaluateSync(
    toolCall,
    makeTurn("没有任何调用"),
    makeContext({ tool: "message" }),
  );
  assert.equal(result.pass, false);
  assert.match(result.reason, /未调用/);
});

test("tool-call：调用存在但 status 非 completed 判 fail", () => {
  const result = evaluateSync(
    toolCall,
    makeTurn("失败了", [{ ...SEND_CALL, status: "failed" }]),
    makeContext({ tool: "message", action: "send" }),
  );
  assert.equal(result.pass, false);
  assert.match(result.reason, /completed/);
});

test("tool-call：args 子集不匹配判 fail，匹配（忽略多余键）通过", () => {
  const miss = evaluateSync(
    toolCall,
    makeTurn("", [SEND_CALL]),
    makeContext({ tool: "message", args: { to: "C" } }),
  );
  assert.equal(miss.pass, false);
  const hit = evaluateSync(
    toolCall,
    makeTurn("", [SEND_CALL]),
    makeContext({ tool: "message", args: { to: "B" } }),
  );
  assert.equal(hit.pass, true);
});

test("tool-call：expect 形状非法显式抛错", () => {
  assert.throws(
    () => evaluateSync(toolCall, makeTurn(""), makeContext("message")),
    /tool-call.*expect/,
  );
  assert.throws(
    () => evaluateSync(toolCall, makeTurn(""), makeContext({})),
    /tool-call.*expect/,
  );
});
