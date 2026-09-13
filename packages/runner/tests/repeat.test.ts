/**
 * @module @x-agent-suite/runner/tests/repeat
 * repeat 统计单元测试：稳定率/聚合分统计、参数校验、混合结果汇总。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentDriver, Criterion } from "@x-agent-suite/contracts";
import {
  runScenarioRepeat,
  summarizeRepeat,
  type RunnerArtifact,
} from "../src/index.ts";

/** 奇偶交替输出的驱动工厂：计数器跨执行共享，制造混合通过结果。 */
function makeAlternatingFactory(): () => AgentDriver {
  let calls = 0;
  return () => ({
    start: async () => {},
    sendPrompt: async () => {
      calls += 1;
      return {
        text: calls % 2 === 1 ? "命中关键词" : "没有目标",
        toolCalls: [],
        toolCallsCount: 0,
        events: [],
      };
    },
    events: () => ({
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.resolve({ done: true, value: undefined }),
      }),
    }),
    close: async () => {},
  });
}

const contains: Criterion = {
  name: "contains",
  scope: "turn",
  evaluate: (turn, context) => ({
    pass: turn.text.includes(context.expect as string),
    score: 1,
    reason: "",
  }),
};

test("混合结果：稳定率 1/2，report 语义正确", async () => {
  const { results, stats } = await runScenarioRepeat(
    {
      id: "test/repeat",
      turns: [{ send: "任意", expect: { contains: "关键词" } }],
    },
    {
      createDriver: makeAlternatingFactory(),
      criteria: [contains],
      repeat: 2,
    },
  );
  assert.equal(results.length, 2);
  assert.equal(stats.runs, 2);
  assert.equal(stats.hardPassCount, 1);
  assert.equal(stats.hardPassRate, 0.5);
  assert.equal(stats.score, undefined, "无聚合场景不出 score 统计");
});

test("聚合场景：score 均值/极值统计", () => {
  const make = (score: number, pass: boolean) => ({
    observation: {
      text: "",
      toolCalls: [],
      toolCallsCount: 0,
      events: [],
    },
    artifact: {
      outcomes: [],
      aggregate: {
        pass,
        score,
        rawScore: score,
        maxScore: 1,
        coverage: { evaluated: 1, total: 1 },
        dimensions: [],
        reason: "",
      },
    } satisfies RunnerArtifact,
    dryPass: true,
    hardPass: pass,
    fuzzyPass: pass,
    latencyMs: 1,
  });
  const stats = summarizeRepeat([make(0.4, false), make(0.8, true)]);
  assert.equal(stats.hardPassRate, 0.5);
  assert.ok(stats.score);
  assert.ok(Math.abs(stats.score.mean - 0.6) < 1e-9);
  assert.equal(stats.score.min, 0.4);
  assert.equal(stats.score.max, 0.8);
});

test("repeat 非正整数显式抛错", async () => {
  await assert.rejects(
    () =>
      runScenarioRepeat(
        { id: "test/x", turns: [{ send: "x" }] },
        {
          createDriver: makeAlternatingFactory(),
          criteria: [],
          repeat: 0,
        },
      ),
    /正整数/,
  );
});
