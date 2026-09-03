/**
 * @module @x-agent-suite/observation/tests/observation-checks
 * 评分层四层检查（dry/hard/fuzzy/enumerate）的单元测试。
 * 不变量：dry+hard 为默认门禁；断言只落在 ToolCall.status 与结构化入参上。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Observation } from "@x-agent-suite/contracts";
import {
  checkListResult,
  dryChecks,
  fuzzyChecks,
  hardChecks,
} from "../src/checks.ts";

/** 构造一条最小合法 Observation。 */
function makeObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    text: "已发送消息。",
    toolCalls: [
      {
        name: "mcp__message__message",
        input: { handle: "A", action: "send", to: "B", message: "hello" },
        output: "delivered=true",
        status: "completed",
      },
    ],
    toolCallsCount: 1,
    steps: 2,
    events: [{ type: "prompt", timestamp: 1 }],
    ...overrides,
  };
}

// ---------- dry ----------

test("dryChecks：合法 Observation 通过", () => {
  assert.deepEqual(dryChecks(makeObservation()), []);
});

test("dryChecks：toolCallsCount 与 toolCalls 长度不一致判失败", () => {
  const failures = dryChecks(makeObservation({ toolCallsCount: 5 }));
  assert.ok(failures.length > 0);
});

test("dryChecks：事件流为空判失败（说明 driver 未产出任何事件）", () => {
  const failures = dryChecks(makeObservation({ events: [] }));
  assert.ok(failures.length > 0);
});

// ---------- hard ----------

test("hardChecks：completed 且入参匹配通过（前缀名按末段匹配 + action 过滤）", () => {
  const failures = hardChecks(makeObservation(), {
    tool: "message",
    action: "send",
    args: { to: "B", message: "hello" },
  });
  assert.deepEqual(failures, []);
});

test("hardChecks：同工具其他 action 不满足 action 过滤（不判假绿）", () => {
  const obs = makeObservation({
    toolCalls: [
      {
        name: "mcp__message__message",
        input: { handle: "A", action: "list" },
        status: "completed",
      },
    ],
  });
  const failures = hardChecks(obs, { tool: "message", action: "send" });
  assert.ok(failures.some((f) => f.includes("未调用")));
});

test("hardChecks：未调用期望工具判失败", () => {
  const failures = hardChecks(
    makeObservation({ toolCalls: [], toolCallsCount: 0 }),
    {
      tool: "message",
      action: "send",
    },
  );
  assert.ok(failures.some((f) => f.includes("message")));
});

test("hardChecks：status=failed 判失败（不容忍宿主假绿）", () => {
  const obs = makeObservation({
    toolCalls: [
      { name: "message", input: { action: "send", to: "B" }, status: "failed" },
    ],
  });
  const failures = hardChecks(obs, { tool: "message", action: "send" });
  assert.ok(failures.length > 0);
});

test("hardChecks：入参不匹配判失败", () => {
  const failures = hardChecks(makeObservation(), {
    tool: "message",
    action: "send",
    args: { to: "B", message: "WRONG" },
  });
  assert.ok(failures.length > 0);
});

// ---------- fuzzy ----------

test("fuzzyChecks：字符串与正则混合匹配", () => {
  assert.deepEqual(
    fuzzyChecks("delivered=true，已发送", ["delivered=true", /已发送/]),
    [],
  );
  assert.ok(fuzzyChecks("什么都没说", ["delivered=true"]).length > 0);
});

test("fuzzyChecks：重复使用带 g/y 标志的正则不会受 lastIndex 污染", () => {
  const global = /ok/g;
  const sticky = /ok/y;
  assert.deepEqual(fuzzyChecks("ok", [global, sticky]), []);
  assert.deepEqual(fuzzyChecks("ok", [global, sticky]), []);
});

// ---------- enumerate ----------

test("checkListResult：逐条核对幻觉与遗漏", () => {
  const extract = /session-[\w-]+/g;
  const result = checkListResult(
    "在线：session-a session-b session-ghost",
    ["session-a", "session-b", "session-c"],
    {
      extract,
      requireComplete: true,
    },
  );
  assert.deepEqual(result.hallucinated, ["session-ghost"]);
  assert.deepEqual(result.missing, ["session-c"]);
});

test("checkListResult：requireComplete=false 时不检查遗漏", () => {
  const result = checkListResult(
    "在线：session-a",
    ["session-a", "session-b"],
    {
      extract: /session-[\w-]+/g,
      requireComplete: false,
    },
  );
  assert.deepEqual(result.hallucinated, []);
  assert.deepEqual(result.missing, []);
});
