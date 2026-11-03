/**
 * @module @x-agent-suite/runner/tests/run-scenario-cleanup
 * runner 取消与错误聚合回归：timeout 先 close，primary/cleanup 两者都保留。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentDriver, Observation } from "@x-agent-suite/contracts";
import { runScenarioSpec } from "../src/run-scenario.ts";

function impossibleObservation(): Observation {
  return { text: "", toolCalls: [], toolCallsCount: 0, events: [] };
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

test("runScenarioSpec：start 与 close 均失败时 AggregateError 保留两者", async () => {
  const driver: AgentDriver = {
    start: async () => {
      throw new Error("PRIMARY_START_BOOM");
    },
    sendPrompt: async () => impossibleObservation(),
    events: () => ({
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: true as const, value: undefined }),
      }),
    }),
    close: async () => {
      throw new Error("CLEANUP_BOOM");
    },
  };
  await assert.rejects(
    () =>
      runScenarioSpec(
        { id: "aggregate-start", turns: [{ send: "x" }] },
        { createDriver: () => driver, criteria: [] },
      ),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(
        error.errors.map((item) =>
          item instanceof Error ? item.message : String(item),
        ),
        ["PRIMARY_START_BOOM", "CLEANUP_BOOM"],
      );
      assert.match(error.message, /PRIMARY_START_BOOM/);
      assert.match(error.message, /CLEANUP_BOOM/);
      return true;
    },
  );
});

test("runScenarioSpec：turn timeout 后立即 close，primary 不被 cleanup 覆盖", async () => {
  let closeCalledAt = 0;
  let sendSettled = false;
  const driver: AgentDriver = {
    start: async () => {},
    sendPrompt: () =>
      new Promise<Observation>((_resolve, reject) => {
        setTimeout(() => {
          sendSettled = true;
          reject(new Error("late send rejection"));
        }, 2_000).unref?.();
      }),
    events: () => ({
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: true as const, value: undefined }),
      }),
    }),
    close: async () => {
      closeCalledAt = Date.now();
      assert.equal(sendSettled, false, "close 必须在 send 迟到结果之前发生");
      throw new Error("CLEANUP_AFTER_TIMEOUT");
    },
  };
  const startedAt = Date.now();
  await assert.rejects(
    () =>
      runScenarioSpec(
        {
          id: "aggregate-timeout",
          turns: [{ send: "hang", timeoutMs: 20 }],
        },
        { createDriver: () => driver, criteria: [] },
      ),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.match(
        error.errors[0] instanceof Error ? error.errors[0].message : "",
        /轮次超时（20ms）/,
      );
      assert.match(
        error.errors[1] instanceof Error ? error.errors[1].message : "",
        /CLEANUP_AFTER_TIMEOUT/,
      );
      return true;
    },
  );
  assert.ok(closeCalledAt > 0);
  assert.ok(Date.now() - startedAt < 500, "timeout 后必须立即进入 close");
});
