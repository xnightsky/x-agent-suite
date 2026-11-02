/**
 * @module @x-agent-suite/recall/tests/recall-assertion-scoring
 * Recall 注册 resolver 预检/缓存、原始分数兼容与固定贡献矩阵。
 */
import assert from "node:assert/strict";
import test from "node:test";
import type {
  AgentDriver,
  CriterionResult,
  ScenarioResult,
  ScenarioSpec,
  SessionCriterion,
} from "@x-agent-suite/contracts";
import type { RunnerArtifact } from "@x-agent-suite/runner";
import { runScenarioSpec } from "@x-agent-suite/runner";
import type {
  LiveConfigOptions,
  TargetTagCatalog,
} from "@x-agent-suite/llm-fixture";
import { adaptRecallAssertionResult } from "../src/assertion-results.ts";
import { preflightRecallAssertionScores } from "../src/assertion-score.ts";
import { assembleRecallCriteria } from "../src/criterion-assembly.ts";
import type { RecallEffects } from "../src/effects.ts";
import type { RecallResolvedExecution } from "../src/execution.ts";
import type { RecallRegistry } from "../src/registry.ts";

const EFFECTS: RecallEffects = {
  kind: "none",
  attribution: "none",
  tools: "none",
  commands: { allow: [], deny: [] },
  maxSteps: 1,
  timeoutMs: 30_000,
  workspace: "isolated",
  cleanup: "required",
};
const CATALOG: TargetTagCatalog = {
  dictionary: { version: 1, keys: [] },
  instances: { cli: [], providers: [], providerModels: [], models: [] },
};
const CONFIG: LiveConfigOptions = { env: {} };
const EXECUTION: RecallResolvedExecution = {
  target: {
    carrier: "carrier-a",
    kind: "ephemeral-client",
    clientRef: "client-a",
    channel: {
      wire: "openai-chat",
      baseUrl: "https://fixture.invalid/v1",
      model: "model-a",
      provider: "provider-a",
    },
  },
  mode: "direct",
  clientRef: "client-a",
};

function scenario(id: string, expect: Record<string, unknown>): ScenarioSpec {
  return { id, turns: [{ send: "main" }], expect, metadata: {} };
}

function registry(criteria: RecallRegistry["criteria"]): RecallRegistry {
  return { criteria, profiles: {}, effectsProfiles: {} };
}

function driver(): AgentDriver {
  return {
    async start() {},
    async sendPrompt() {
      return { text: "final", toolCalls: [], toolCallsCount: 0, events: [] };
    },
    async *events() {},
    async close() {},
  };
}

async function assemble(
  scenarios: readonly ScenarioSpec[],
  registrations: RecallRegistry["criteria"],
) {
  return assembleRecallCriteria({
    registry: registry(registrations),
    scenarios,
    execution: EXECUTION,
    config: CONFIG,
    catalog: CATALOG,
    liveReviewApproved: true,
    effects: EFFECTS,
  });
}

function booleanResult(pass: boolean, score = pass ? 1 : 0): CriterionResult {
  return { pass, score, reason: pass ? "通过" : "未通过" };
}

test("两种 opt-in 输入协议逐 case 预检缓存，运行与报告不再解析", async () => {
  const scoreCalls: unknown[] = [];
  const rewardCalls: unknown[] = [];
  const registrations: RecallRegistry["criteria"] = [
    {
      name: "score-field",
      scope: "session",
      assertionScore: (expect) => {
        scoreCalls.push(expect);
        return (
          (expect as { score?: { hit?: number; miss?: number } }).score ?? {}
        );
      },
      evaluate: (_session, context) =>
        booleanResult((context.expect as { pass: boolean }).pass, 0.4),
    },
    {
      name: "reward-field",
      scope: "session",
      assertionScore: (expect) => {
        rewardCalls.push(expect);
        return (
          (expect as { reward?: { hit?: number; miss?: number } }).reward ?? {}
        );
      },
      create: () => ({
        name: "reward-field",
        scope: "session",
        evaluate: (_session: never, context: { expect: unknown }) =>
          booleanResult((context.expect as { pass: boolean }).pass, 0.4),
      }),
    },
  ];
  const oneInput = { pass: false, score: { hit: 8 } };
  const oneReward = { pass: true, reward: { hit: 4, miss: -9 } };
  const twoInput = { pass: true, score: { miss: -5 } };
  const twoReward = { pass: false, reward: { hit: 0, miss: 0 } };
  const one = scenario("suite/one", {
    "score-field": oneInput,
    "reward-field": oneReward,
  });
  const two = scenario("suite/two", {
    "score-field": twoInput,
    "reward-field": twoReward,
  });
  const criteria = await assemble([one, two], registrations);
  assert.deepEqual(scoreCalls, [oneInput, twoInput]);
  assert.deepEqual(rewardCalls, [oneReward, twoReward]);

  const firstRaw = await runScenarioSpec(one, {
    createDriver: driver,
    criteria,
  });
  const secondRaw = await runScenarioSpec(two, {
    createDriver: driver,
    criteria,
  });
  const first = adaptRecallAssertionResult(one, firstRaw, EXECUTION);
  const second = adaptRecallAssertionResult(two, secondRaw, EXECUTION);
  assert.equal(first.artifact.rawScore, 3, "-1 + 4");
  assert.equal(second.artifact.rawScore, 1, "+1 + 0");
  assert.equal(first.hardPass, false);
  assert.equal(second.hardPass, false);
  assert.deepEqual(
    first.artifact.outcomes.map((outcome) => outcome.score),
    [0.4, 0.4],
    "原始合法小数不改写",
  );
  assert.deepEqual(scoreCalls, [oneInput, twoInput]);
  assert.deepEqual(rewardCalls, [oneReward, twoReward]);
});

test("未 opt-in 的历史 score 字段原样透传，原始 0.4 与默认贡献分离", async () => {
  let received: unknown;
  const input = { score: { hit: 99 }, payload: { exact: true } };
  const current = scenario("suite/legacy", { legacy: input });
  const legacy: SessionCriterion = {
    name: "legacy",
    scope: "session",
    evaluate: (_session, context) => {
      received = context.expect;
      return { pass: true, score: 0.4, reason: "历史协议" };
    },
  };
  const criteria = await assemble([current], [legacy]);
  const raw = await runScenarioSpec(current, {
    createDriver: driver,
    criteria,
  });
  const result = adaptRecallAssertionResult(current, raw, EXECUTION);
  assert.equal(received, input, "expect 不包装、不替换");
  assert.equal(result.artifact.outcomes[0]!.score, 0.4);
  assert.equal(result.artifact.assertions![0]!.score, 1);
  assert.equal(result.artifact.rawScore, 1);
});

test("resolver 非法返回与抛错均在装配预检拒绝，未引用 resolver 不调用", async () => {
  const invalid = [
    null,
    [],
    Promise.resolve({}),
    new Date(),
    { hit: Infinity },
    { miss: NaN },
    { hit: 1, extra: 2 },
  ];
  for (const value of invalid) {
    const current = scenario("suite/invalid", { metric: {} });
    await assert.rejects(
      assemble(
        [current],
        [
          {
            name: "metric",
            scope: "session",
            assertionScore: () => value as { hit?: number },
            evaluate: () => booleanResult(true),
          },
        ],
      ),
      /assertionScore|score|有限|未知字段/,
    );
  }
  await assert.rejects(
    assemble(
      [scenario("suite/throw", { metric: {} })],
      [
        {
          name: "metric",
          scope: "session",
          assertionScore: () => {
            throw new Error("resolver failed");
          },
          evaluate: () => booleanResult(true),
        },
      ],
    ),
    /assertionScore|resolver/,
  );

  let calls = 0;
  await assemble(
    [scenario("suite/unreferenced", { other: {} })],
    [
      {
        name: "other",
        scope: "session",
        evaluate: () => booleanResult(true),
      },
      {
        name: "unused",
        scope: "session",
        assertionScore: () => {
          calls += 1;
          return {};
        },
        evaluate: () => booleanResult(true),
      },
    ],
  );
  assert.equal(calls, 0);
});

test("五项机械 hit=0/miss=-1：一项失败 -1，两项失败 -2", async () => {
  const registrations: RecallRegistry["criteria"] = Array.from(
    { length: 5 },
    (_, index) => ({
      name: "m" + index,
      scope: "session" as const,
      assertionScore: () => ({ hit: 0, miss: -1 }),
      evaluate: (_session: never, context: { expect: unknown }) =>
        booleanResult(context.expect as boolean),
    }),
  );
  const oneMiss = scenario("suite/one-miss", {
    m0: true,
    m1: false,
    m2: true,
    m3: true,
    m4: true,
  });
  const twoMiss = scenario("suite/two-miss", {
    m0: false,
    m1: false,
    m2: true,
    m3: true,
    m4: true,
  });
  const criteria = await assemble([oneMiss, twoMiss], registrations);
  const first = adaptRecallAssertionResult(
    oneMiss,
    await runScenarioSpec(oneMiss, { createDriver: driver, criteria }),
    EXECUTION,
  );
  const second = adaptRecallAssertionResult(
    twoMiss,
    await runScenarioSpec(twoMiss, { createDriver: driver, criteria }),
    EXECUTION,
  );
  assert.equal(first.artifact.rawScore, -1);
  assert.equal(second.artifact.rawScore, -2);
  assert.equal(first.hardPass, false);
  assert.equal(second.hardPass, false);
});

test("机械判据与原型属性同名时仍使用机械来源和预检分值", async () => {
  const judgeName = "__recall_judge__:accurate";
  const current: ScenarioSpec = {
    ...scenario("suite/prototype-name", {
      toString: {},
      [judgeName]: { rubric: "accurate" },
    }),
    metadata: {
      recall: {
        judge: { rubrics: { accurate: { rubric: "accurate" } } },
      },
    },
  };
  const mechanical = {
    name: "toString",
    scope: "session" as const,
    assertionScore: () => ({ hit: 7 }),
    evaluate: () => booleanResult(true),
  };
  const ai: SessionCriterion = {
    name: judgeName,
    scope: "session",
    evaluate: () => booleanResult(true),
  };
  preflightRecallAssertionScores({
    registry: registry([mechanical]),
    scenarios: [current],
    execution: EXECUTION,
  });
  const raw = await runScenarioSpec(current, {
    createDriver: driver,
    criteria: [mechanical, ai],
  });
  const result = adaptRecallAssertionResult(current, raw, EXECUTION);
  assert.deepEqual(
    result.artifact.assertions?.map(({ name, source, score }) => ({
      name,
      source,
      score,
    })),
    [
      { name: "toString", source: "mechanical", score: 7 },
      { name: "accurate", source: "ai", score: 1 },
    ],
  );
});
