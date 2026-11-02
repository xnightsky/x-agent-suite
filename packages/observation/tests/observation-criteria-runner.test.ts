/**
 * @module @x-agent-suite/observation/tests/observation-criteria-runner
 * runCriteria 判据调度单元测试：分发、跳过、引用完整性、异步判据。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  CriterionResult,
  Criterion,
  SessionObservation,
  TurnObservation,
} from "@x-agent-suite/contracts";
import { runCriteria } from "../src/criteria-runner.ts";
import { createEvidenceCriterion } from "@x-agent-suite/assertions";

/** 构造一轮观测。 */
function makeTurn(index: number, text: string): TurnObservation {
  return {
    index,
    sent: `第 ${index} 轮`,
    text,
    toolCalls: [],
    commands: [],
    startedAt: index,
    endedAt: index + 1,
    metadata: {},
  };
}

/** 构造最小合法会话。 */
function makeSession(turns: TurnObservation[]): SessionObservation {
  return {
    driver: "mock",
    turns,
    text: turns.map((turn) => turn.text).join("\n"),
    toolCalls: [],
    commands: [],
    exhausted: false,
    metadata: {},
  };
}

/** 演示用 turn 判据：文本包含 expect 字符串即过。 */
const containsTurn: Criterion = {
  name: "demo-contains",
  scope: "turn",
  evaluate: (turn, context) => ({
    pass: turn.text.includes(context.expect as string),
    score: 1,
    reason: "",
  }),
};

/** 演示用 session 判据：全会话文本包含 expect 即过（异步实现）。 */
const containsSession: Criterion = {
  name: "demo-session",
  scope: "session",
  evaluate: async (session, context) => ({
    pass: session.text.includes(context.expect as string),
    score: 1,
    reason: "",
  }),
};

test("turn 判据按轮分发：只跑声明了 expect 的轮次", async () => {
  const turns = [makeTurn(0, "你好"), makeTurn(1, "世界")];
  const outcomes = await runCriteria({
    session: makeSession(turns),
    criteria: [containsTurn],
    turnExpects: [{ "demo-contains": "你好" }, undefined],
  });
  assert.equal(outcomes.length, 1);
  assert.deepEqual(outcomes[0], {
    name: "demo-contains",
    scope: "turn",
    turnIndex: 0,
    pass: true,
    score: 1,
    reason: "",
  });
});

test("session 判据经 sessionExpect 分发，异步实现被 await", async () => {
  const outcomes = await runCriteria({
    session: makeSession([makeTurn(0, "你好")]),
    criteria: [containsSession],
    sessionExpect: { "demo-session": "你好" },
  });
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0]!.scope, "session");
  assert.equal(outcomes[0]!.pass, true);
});

test("未被 expect 引用的判据跳过不跑", async () => {
  const outcomes = await runCriteria({
    session: makeSession([makeTurn(0, "你好")]),
    criteria: [containsTurn, containsSession],
    turnExpects: [{ "demo-contains": "你好" }],
  });
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0]!.name, "demo-contains");
});

test("引用完整性：expect 引用了未注册的判据名显式抛错", async () => {
  await assert.rejects(
    () =>
      runCriteria({
        session: makeSession([makeTurn(0, "你好")]),
        criteria: [containsTurn],
        turnExpects: [{ "demo-contians": "你好" }],
      }),
    /demo-contians/,
  );
  await assert.rejects(
    () =>
      runCriteria({
        session: makeSession([makeTurn(0, "你好")]),
        criteria: [containsTurn],
        sessionExpect: { "demo-contains": "你好" },
      }),
    /session 判据：demo-contains/,
  );
});

test("同名同 scope 判据重复注册显式抛错", async () => {
  await assert.rejects(
    () =>
      runCriteria({
        session: makeSession([makeTurn(0, "你好")]),
        criteria: [containsTurn, containsTurn],
        turnExpects: [{ "demo-contains": "你好" }],
      }),
    /重复/,
  );
});

test("判据结果必须满足公共形状，合法 0.4 原样保留", async () => {
  const invalid = [
    undefined,
    { pass: "yes", score: 1, reason: "bad" },
    { pass: true, score: Number.NaN, reason: "bad" },
    { pass: true, score: -0.5, reason: "bad" },
    { pass: true, score: 1 },
  ];
  for (const value of invalid) {
    const broken: Criterion = {
      name: "broken",
      scope: "turn",
      evaluate: () => value as CriterionResult,
    };
    await assert.rejects(
      runCriteria({
        session: makeSession([makeTurn(0, "你好")]),
        criteria: [broken],
        turnExpects: [{ broken: true }],
      }),
      /pass|score|reason/,
    );
  }
  const decimal: Criterion = {
    name: "decimal",
    scope: "turn",
    evaluate: () => ({ pass: true, score: 0.4, reason: "decimal" }),
  };
  const outcomes = await runCriteria({
    session: makeSession([makeTurn(0, "你好")]),
    criteria: [decimal],
    turnExpects: [{ decimal: true }],
  });
  assert.equal(outcomes[0]!.score, 0.4);
});

test("判据附加身份字段不得覆盖调度器写入的 name/scope/turnIndex", async () => {
  const turnCriterion: Criterion = {
    name: "turn-real",
    scope: "turn",
    evaluate: () =>
      ({
        name: "spoofed-turn",
        scope: "session",
        turnIndex: 99,
        pass: true,
        score: 1,
        reason: "turn",
      }) as CriterionResult,
  };
  const sessionCriterion: Criterion = {
    name: "session-real",
    scope: "session",
    evaluate: () =>
      ({
        name: "spoofed-session",
        scope: "turn",
        pass: true,
        score: 1,
        reason: "session",
      }) as CriterionResult,
  };
  const outcomes = await runCriteria({
    session: makeSession([makeTurn(0, "你好")]),
    criteria: [turnCriterion, sessionCriterion],
    turnExpects: [{ "turn-real": true }],
    sessionExpect: { "session-real": true },
  });
  assert.deepEqual(outcomes, [
    {
      name: "turn-real",
      scope: "turn",
      turnIndex: 0,
      pass: true,
      score: 1,
      reason: "turn",
    },
    {
      name: "session-real",
      scope: "session",
      pass: true,
      score: 1,
      reason: "session",
    },
  ]);
});

test("evidence 作为普通 TurnCriterion 复用现有调度与 outcome 投影", async () => {
  const turn: TurnObservation = {
    ...makeTurn(0, "依据 docs/a.md"),
    toolCalls: [
      {
        name: "read",
        input: { path: "docs/a.md" },
        output: { content: [{ type: "text", text: "正文" }] },
        status: "completed",
      },
    ],
    metadata: { workspaceCwd: "/sandbox/root" },
  };
  const criterion = createEvidenceCriterion({
    resolveWorkspaceCwd: (current) =>
      current.metadata.workspaceCwd as string | undefined,
  });
  const outcomes = await runCriteria({
    session: makeSession([turn]),
    criteria: [criterion],
    turnExpects: [
      {
        evidence: {
          citation: { tool: "read", pathArg: "path", path: "docs/a.md" },
        },
      },
    ],
  });
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0]!.name, "evidence");
  assert.equal(outcomes[0]!.pass, true);
  assert.equal(outcomes[0]!.score, 1);
});
