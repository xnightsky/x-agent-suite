/**
 * @module scripts/tests/judge-pi-assertion-artifact
 * 公开打包 Judge + Pi borrowed + Assertions 组合回归。
 * 不变量：只导入公开制品与教程合成 CLI；独立 workspace、零真实凭据、零网络、零 token。
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import type {
  TurnCriterionContext,
  TurnObservation,
} from "@x-agent-suite/contracts";
import type { RecallEffects } from "@x-agent-suite/recall";
import {
  createSyntheticConfig,
  readSyntheticPiProbes,
  syntheticTags,
  syntheticTarget,
  writeSyntheticPi,
} from "../../examples/tutorial/fixtures/judge-pi-fake.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const CORE_NAMES = [
  "contracts",
  "driver",
  "sandbox",
  "llm-fixture",
  "harness",
  "observation",
  "criteria",
  "matrix",
  "runner",
  "recall",
  "judge",
  "assertions",
] as const;
const EFFECTS: RecallEffects = {
  kind: "none",
  attribution: "none",
  tools: "none",
  commands: { allow: [], deny: [] },
  maxSteps: 1,
  timeoutMs: 5_000,
  workspace: "isolated",
  cleanup: "required",
};
const CONTEXT = {
  turnIndex: 0,
  session: {
    driver: "mock",
    turns: [],
    text: "",
    toolCalls: [],
    commands: [],
    exhausted: false,
    metadata: {},
  },
  expect: [{ name: "grounded", rubric: "回答是否基于本轮文本" }],
} satisfies TurnCriterionContext;

let stage: string;
let judgeApi: typeof import("@x-agent-suite/judge");
let assertionsApi: typeof import("@x-agent-suite/assertions");
let piRecallApi: typeof import("../../profiles/pi-recall.ts");
let fixtureApi: typeof import("@x-agent-suite/llm-fixture");

before(async () => {
  await mkdir(join(ROOT, ".tmp"), { recursive: true });
  stage = await mkdtemp(join(ROOT, ".tmp", "xas-judge-pi-assertion-"));
  const entries = Object.fromEntries(
    CORE_NAMES.map((name) => [
      name,
      join(ROOT, "packaging", "entries", name + ".ts"),
    ]),
  ) as Record<(typeof CORE_NAMES)[number], string>;
  const outdir = join(stage, "dist");
  await build({
    absWorkingDir: ROOT,
    entryPoints: {
      ...entries,
      "profiles/pi-recall": join(ROOT, "profiles/pi-recall.ts"),
    },
    alias: Object.fromEntries(
      CORE_NAMES.map((name) => ["@x-agent-suite/" + name, entries[name]]),
    ),
    outdir,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    sourcemap: true,
    banner: {
      js: 'import { createRequire as __xasCreateRequire } from "node:module"; const require = __xasCreateRequire(import.meta.url);',
    },
  });
  [judgeApi, assertionsApi, piRecallApi, fixtureApi] = await Promise.all([
    import(pathToFileURL(join(outdir, "judge.js")).href),
    import(pathToFileURL(join(outdir, "assertions.js")).href),
    import(pathToFileURL(join(outdir, "profiles/pi-recall.js")).href),
    import(pathToFileURL(join(outdir, "llm-fixture.js")).href),
  ]);
});

after(async () => {
  if (stage) await rm(stage, { recursive: true, force: true });
});

/** 构造公开 Criterion 所需的最小轮次。 */
function turn(text: string): TurnObservation {
  return {
    index: 0,
    sent: "题面",
    text,
    toolCalls: [],
    commands: [],
    startedAt: 0,
    endedAt: 1,
    metadata: {},
  };
}

test("公开 Judge + Pi + assertion 直接组合并保留失败/清理语义", async () => {
  const target = syntheticTarget();
  const tags = syntheticTags(
    (await fixtureApi.loadTargetTagCatalog({ repoRoot: ROOT, homeDir: stage }))
      .dictionary,
  );
  const config = createSyntheticConfig(stage);
  const { commandOverride, probeLog } = await writeSyntheticPi(stage);
  const client = judgeApi.createJudgeClient({
    target,
    tags,
    config,
    liveReviewApproved: true,
    mode: "borrowed",
    toolPolicy: "none",
    createDriver: ({ backend, target: current, cliRef }) =>
      piRecallApi.createPiRecallDriver(
        {
          backend,
          target: current,
          cliRef,
          spec: { id: "judge/single-turn", turns: [{ send: "judge" }] },
          effects: EFFECTS,
          executionParams: {},
        },
        { commandOverride },
      ),
  });
  const criterion = assertionsApi.createJudgeAssertion({
    name: "answer-quality",
    client,
    maxRetries: 0,
  });

  const success = await criterion.evaluate(turn("answer"), CONTEXT);
  assert.deepEqual(success, {
    pass: true,
    score: 1,
    reason: "全部 1 项 rubric 通过",
  });
  for (const [text, prefix] of [
    ["__INCOMPLETE__", "[not-evaluated:client]"],
    ["__ABSENT__", "[absent]"],
  ] as const) {
    let failure: unknown;
    try {
      await criterion.evaluate(turn(text), CONTEXT);
    } catch (error) {
      failure = error;
    }
    assert.ok(failure instanceof Error);
    assert.equal(failure.message.startsWith(prefix), true);
  }

  const probes = await readSyntheticPiProbes(probeLog);
  const starts = probes.filter((probe) => probe.event === "start");
  assert.equal(starts.length, 3);
  assert.equal(probes.filter((probe) => probe.event === "exit").length, 3);
  assert.equal(new Set(starts.map((probe) => probe.cwd)).size, 3);
  for (const probe of starts) {
    assert.equal(probe.judge, true);
    assert.equal(probe.secretInPrompt, false);
    assert.equal(existsSync(probe.cwd!), false);
    assert.equal(existsSync(probe.home!), false);
  }
});
