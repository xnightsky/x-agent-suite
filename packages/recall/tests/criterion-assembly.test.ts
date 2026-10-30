/**
 * @module @x-agent-suite/recall/tests/criterion-assembly
 * assembleRecallCriteria 单元测试：合成 registry / scenarios / execution，零 token 零网络。
 * 不变量：
 * - 引用收集按 expect 键存在性（Object.keys 语义），truthy 过滤非法；
 * - 每 target 每工厂恰好调用一次；静态判据原样保留且顺序不变；
 * - 装配错误只含 scope:name 与阶段，不回显 context/config/插件异常内容。
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { Criterion, ScenarioSpec } from "@x-agent-suite/contracts";
import type {
  LiveConfigOptions,
  ResolvedLiveTarget,
  TargetTagCatalog,
} from "@x-agent-suite/llm-fixture";
import { assembleRecallCriteria } from "../src/criterion-assembly.ts";
import type { RecallEffects } from "../src/effects.ts";
import type { RecallResolvedExecution } from "../src/execution.ts";
import type {
  RecallCriterionFactory,
  RecallCriterionFactoryContext,
  RecallRegistry,
} from "../src/registry.ts";

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

/** 静态判据模板。 */
function staticCriterion(name: string): Criterion {
  return {
    name,
    scope: "turn",
    evaluate: () => ({ pass: true, score: 1, reason: "" }),
  };
}

/** 记录 create 入参的工厂；returns 指定 create 结果或默认合法判据。 */
function recordingFactory(
  name: string,
  calls: RecallCriterionFactoryContext[],
  options: { scope?: "turn" | "session"; returns?: unknown } = {},
): RecallCriterionFactory {
  return {
    name,
    scope: options.scope ?? "turn",
    create: async (context) => {
      calls.push(context);
      if (options.returns !== undefined) return options.returns as Criterion;
      return staticCriterion(name);
    },
  };
}

/** 单 case 单轮考卷；expects 为 expect 键值对（false/0/null 用于键存在性用例）。 */
function scenarioWithExpect(
  expects: Record<string, unknown>,
): readonly ScenarioSpec[] {
  return [
    {
      id: "suite/case",
      turns: [{ send: "hello", expect: expects }],
      metadata: {},
    },
  ];
}

function assemble(
  registry: Pick<RecallRegistry, "criteria">,
  scenarios: readonly ScenarioSpec[],
) {
  return assembleRecallCriteria({
    registry: registry as RecallRegistry,
    scenarios,
    execution: EXECUTION,
    config: CONFIG,
    catalog: CATALOG,
    liveReviewApproved: true,
    effects: EFFECTS,
  });
}

test("静态判据原样保留且顺序不变，引用工厂每 target 一次，未引用工厂零调用", async () => {
  const usedCalls: RecallCriterionFactoryContext[] = [];
  const unusedCalls: RecallCriterionFactoryContext[] = [];
  const used = recordingFactory("used-metric", usedCalls);
  const unused = recordingFactory("unused-metric", unusedCalls);
  const staticOne = staticCriterion("static-one");
  const criteria = await assemble(
    { criteria: [staticOne, used, unused] },
    scenarioWithExpect({ "used-metric": [{ name: "q", rubric: "标准" }] }),
  );
  assert.deepEqual(
    criteria.map((item) => item.name),
    ["static-one", "used-metric"],
  );
  assert.equal(criteria[0], staticOne, "静态判据应保持原对象");
  assert.equal(usedCalls.length, 1);
  assert.equal(unusedCalls.length, 0, "未引用工厂不得创建 client 或触发准入");
});

test("expect 键存在即引用：false/0/null/空串均触发装配，不做 truthy 过滤", async () => {
  const calls: RecallCriterionFactoryContext[] = [];
  await assemble(
    { criteria: [recordingFactory("falsy-metric", calls)] },
    scenarioWithExpect({ "falsy-metric": false }),
  );
  await assemble(
    { criteria: [recordingFactory("zero-metric", calls)] },
    scenarioWithExpect({ "zero-metric": 0 }),
  );
  await assemble(
    { criteria: [recordingFactory("null-metric", calls)] },
    scenarioWithExpect({ "null-metric": null }),
  );
  await assemble(
    { criteria: [recordingFactory("empty-metric", calls)] },
    scenarioWithExpect({ "empty-metric": "" }),
  );
  assert.equal(calls.length, 4, "字段出现即算引用，falsy 值不得跳过装配");
});

test("同源装配上下文原样到达工厂：target/config/tags/批准/effects/cliRef/clientRef", async () => {
  const calls: RecallCriterionFactoryContext[] = [];
  await assemble(
    { criteria: [recordingFactory("ctx-metric", calls)] },
    scenarioWithExpect({ "ctx-metric": true }),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.target, EXECUTION.target);
  assert.equal(calls[0]!.config, CONFIG);
  assert.equal(calls[0]!.tags, CATALOG);
  assert.equal(calls[0]!.liveReviewApproved, true);
  assert.equal(calls[0]!.clientRef, "client-a");
  assert.equal(calls[0]!.cliRef, undefined);
  assert.equal(calls[0]!.effects, EFFECTS);
});

test("工厂返回 name/scope 不符或缺 evaluate 时在装配期拒绝，错误只含 scope:name 与阶段", async () => {
  const wrongName: RecallCriterionFactoryContext[] = [];
  await assert.rejects(
    assemble(
      {
        criteria: [
          recordingFactory("declared-name", wrongName, {
            returns: staticCriterion("other-name"),
          }),
        ],
      },
      scenarioWithExpect({ "declared-name": true }),
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /turn:declared-name/);
      assert.match(error.message, /形状校验/);
      assert.doesNotMatch(error.message, /carrier-a|provider-a|model-a/);
      return true;
    },
  );
  const missingEvaluate: RecallCriterionFactoryContext[] = [];
  await assert.rejects(
    assemble(
      {
        criteria: [
          recordingFactory("no-evaluate", missingEvaluate, {
            returns: { name: "no-evaluate", scope: "turn" } as Criterion,
          }),
        ],
      },
      scenarioWithExpect({ "no-evaluate": true }),
    ),
    /形状校验/,
  );
});

test("工厂异常包装为只含 scope:name 与阶段，cause 保留且不回显插件异常内容", async () => {
  const boom = new Error("plugin-secret-detail");
  const factory: RecallCriterionFactory = {
    name: "boom-metric",
    scope: "turn",
    create: () => {
      throw boom;
    },
  };
  await assert.rejects(
    assemble(
      { criteria: [factory] },
      scenarioWithExpect({ "boom-metric": true }),
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /turn:boom-metric/);
      assert.match(error.message, /阶段：create/);
      assert.doesNotMatch(error.message, /plugin-secret-detail/);
      assert.equal(error.cause, boom, "cause 链应保留原始异常");
      return true;
    },
  );
});

test("session scope 工厂声明合法，但当前 DSL 无 session 引用入口，装配期不调用", async () => {
  const calls: RecallCriterionFactoryContext[] = [];
  const criteria = await assemble(
    {
      criteria: [
        recordingFactory("session-metric", calls, { scope: "session" }),
      ],
    },
    scenarioWithExpect({ "turn-only": true }),
  );
  assert.equal(calls.length, 0);
  assert.equal(criteria.length, 0);
});

test("多 case 引用同一工厂仍只装配一次", async () => {
  const calls: RecallCriterionFactoryContext[] = [];
  const scenarios: ScenarioSpec[] = [
    {
      id: "s/one",
      turns: [{ send: "a", expect: { shared: true } }],
      metadata: {},
    },
    {
      id: "s/two",
      turns: [{ send: "b", expect: { shared: false } }],
      metadata: {},
    },
  ];
  await assemble({ criteria: [recordingFactory("shared", calls)] }, scenarios);
  assert.equal(calls.length, 1);
});
