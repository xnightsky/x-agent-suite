/**
 * @module @x-agent-suite/runner/tests/run-scenario
 * runScenarioSpec 单元测试：逐轮执行、判据调度、聚合接线、超时与生命周期。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  AgentDriver,
  Criterion,
  Observation,
  ScenarioSpec,
} from "@x-agent-suite/contracts";
import { MockDriver } from "@x-agent-suite/driver";
import { runScenarioSpec, type RunnerArtifact } from "../src/run-scenario.ts";

/** 文本包含判据（测试用）。 */
const contains: Criterion = {
  name: "contains",
  scope: "turn",
  evaluate: (turn, context) => ({
    pass: turn.text.includes(context.expect as string),
    score: 1,
    reason: "",
  }),
};

/** 记录 close 的 MockDriver 包装。 */
class TrackedMockDriver extends MockDriver {
  closeCalled = false;
  override async close(reason?: string): Promise<void> {
    this.closeCalled = true;
    await super.close(reason);
  }
}

/** 构造单轮场景。 */
function makeSpec(overrides: Partial<ScenarioSpec> = {}): ScenarioSpec {
  return {
    id: "test/demo",
    turns: [{ send: "你好，世界", expect: { contains: "你好" } }],
    ...overrides,
  };
}

test("单轮执行：判据命中，无聚合时 hardPass=判据全过", async () => {
  const result = await runScenarioSpec(makeSpec(), {
    createDriver: () => new MockDriver(),
    criteria: [contains],
  });
  const artifact = result.artifact as RunnerArtifact;
  assert.equal(result.hardPass, true);
  assert.equal(result.dryPass, true);
  assert.equal(artifact.outcomes.length, 1);
  assert.equal(artifact.aggregate, undefined);
});

test("多轮执行：逐轮 sendPrompt 且各轮独立判定", async () => {
  const spec = makeSpec({
    turns: [
      { send: "第一轮你好", expect: { contains: "你好" } },
      { send: "第二轮没有关键词", expect: { contains: "你好" } },
    ],
  });
  const result = await runScenarioSpec(spec, {
    createDriver: () => new MockDriver(),
    criteria: [contains],
  });
  const artifact = result.artifact as RunnerArtifact;
  assert.equal(artifact.outcomes.length, 2);
  assert.equal(artifact.outcomes[0]!.pass, true);
  assert.equal(artifact.outcomes[1]!.pass, false);
  assert.equal(result.hardPass, false);
});

test("聚合接线：spec.aggregate 存在时 hardPass=聚合出口，reason 进 error", async () => {
  const spec = makeSpec({
    aggregate: {
      dimensions: [
        { metric: "contains", weight: 2 },
        { metric: "style", weight: 1 },
      ],
      threshold: 0.5,
    },
  });
  const result = await runScenarioSpec(spec, {
    createDriver: () => new MockDriver(),
    criteria: [contains],
  });
  const artifact = result.artifact as RunnerArtifact;
  assert.ok(artifact.aggregate);
  assert.equal(artifact.aggregate.score, 1);
  assert.deepEqual(artifact.aggregate.coverage, { evaluated: 1, total: 2 });
  assert.equal(result.hardPass, true);
});

test("driver 生命周期：正常结束与异常均 close", async () => {
  const tracked = new TrackedMockDriver();
  await runScenarioSpec(makeSpec(), {
    createDriver: () => tracked,
    criteria: [contains],
  });
  assert.equal(tracked.closeCalled, true);

  const failing: AgentDriver = {
    start: async () => {},
    sendPrompt: () => Promise.reject(new Error("驱动爆炸")),
    events: () => ({
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.resolve({ done: true, value: undefined }),
      }),
    }),
    close: async () => {},
  };
  await assert.rejects(
    () =>
      runScenarioSpec(makeSpec(), {
        createDriver: () => failing,
        criteria: [contains],
      }),
    /驱动爆炸/,
  );
});

test("轮次超时显式抛错", async () => {
  const stalled: AgentDriver = {
    start: async () => {},
    sendPrompt: () => new Promise<Observation>(() => {}),
    events: () => ({
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.resolve({ done: true, value: undefined }),
      }),
    }),
    close: async () => {},
  };
  await assert.rejects(
    () =>
      runScenarioSpec(makeSpec({ turns: [{ send: "卡死", timeoutMs: 50 }] }), {
        createDriver: () => stalled,
        criteria: [contains],
      }),
    /超时/,
  );
});

test("driver 提供的 metadata 透传进 TurnObservation（领域证据自由区）", async () => {
  const withEvidence: AgentDriver = {
    start: async () => {},
    sendPrompt: async (text) => ({
      text,
      toolCalls: [],
      toolCallsCount: 0,
      events: [],
      metadata: { sideEffect: "role-a.json 快照" },
    }),
    events: () => ({
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.resolve({ done: true, value: undefined }),
      }),
    }),
    close: async () => {},
  };
  const evidenceCheck: Criterion = {
    name: "evidence-check",
    scope: "turn",
    evaluate: (turn) => ({
      pass: turn.metadata.sideEffect === "role-a.json 快照",
      score: 1,
      reason: String(turn.metadata.sideEffect ?? "无证据"),
    }),
  };
  const result = await runScenarioSpec(
    makeSpec({ turns: [{ send: "你好", expect: { "evidence-check": true } }] }),
    { createDriver: () => withEvidence, criteria: [evidenceCheck] },
  );
  assert.equal(result.hardPass, true);
});

test("空轮次场景显式抛错", async () => {
  await assert.rejects(
    () =>
      runScenarioSpec(makeSpec({ turns: [] }), {
        createDriver: () => new MockDriver(),
        criteria: [contains],
      }),
    /未声明任何轮次/,
  );
});
