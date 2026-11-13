/** 组合 DSL 的公开装载/装配预检：严格 schema、保留名、引用与共同 miss。 */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import test from "node:test";
import { runRecall } from "../src/index.ts";
import { firstOfWorkspace } from "./fixtures/first-of-workspace.ts";
import { readJudgeRequests } from "./fixtures/recall-judge.registry.ts";

const branch = (name: string) => ({
  name,
  expect: { judge: { [name]: { rubric: name } } },
});

const invalidCases: readonly [string, object][] = [
  ["allOf 空 KV", { allOf: {} }],
  ["allOf 空分支", { allOf: { point: [] } }],
  ["anyOf 单分支", { anyOf: { point: [branch("pass-a")] } }],
  [
    "point 点号",
    { anyOf: { "bad.point": [branch("pass-a"), branch("pass-b")] } },
  ],
  ["分支未知字段", { allOf: { point: [{ ...branch("pass-a"), weight: 1 }] } }],
  ["分支重名", { allOf: { point: [branch("pass-a"), branch("pass-a")] } }],
  ["嵌套组合", { allOf: { point: [{ name: "a", expect: { anyOf: {} } }] } }],
  [
    "分支 decision",
    { allOf: { point: [{ name: "a", expect: { decision: {} } }] } },
  ],
  [
    "显式分支 score 与内部叶子 score 互斥",
    {
      firstOf: {
        point: [
          {
            name: "a",
            score: { hit: 1, miss: -1 },
            expect: { judge: { a: { rubric: "a", score: { hit: 2 } } } },
          },
          { ...branch("pass-b"), score: { hit: 1, miss: -1 } },
        ],
      },
    },
  ],
];

test("非法组合在主执行前拒绝", async (t) => {
  for (const [name, expect] of invalidCases) {
    await t.test(name, async (t) => {
      const ws = await firstOfWorkspace(t, expect);
      process.env.XAS_RECALL_TEST_JUDGE_LOG = ws.log;
      t.after(() => delete process.env.XAS_RECALL_TEST_JUDGE_LOG);
      await assert.rejects(runRecall(ws.options));
      assert.equal((await readJudgeRequests(ws.log)).length, 0);
    });
  }
});

test("省略分支 score 时也在主执行前校验内部叶子的共同 miss", async (t) => {
  const ws = await firstOfWorkspace(t, {
    anyOf: {
      point: [
        { name: "a", expect: { judge: { "pass-a": { rubric: "pass-a" } } } },
        {
          name: "b",
          expect: {
            judge: {
              "pass-b": { rubric: "pass-b" },
              "pass-c": { rubric: "pass-c" },
            },
          },
        },
      ],
    },
  });
  process.env.XAS_RECALL_TEST_JUDGE_LOG = ws.log;
  t.after(() => delete process.env.XAS_RECALL_TEST_JUDGE_LOG);
  await assert.rejects(runRecall(ws.options), /miss/);
  assert.equal((await readJudgeRequests(ws.log)).length, 0);
});

test("未注册引用与所有组合保留名均在主执行前拒绝", async (t) => {
  await t.test("anyOf 后档未注册引用", async (t) => {
    const ws = await firstOfWorkspace(t, {
      anyOf: {
        point: [branch("pass-a"), { name: "b", expect: { missing: {} } }],
      },
    });
    process.env.XAS_RECALL_TEST_JUDGE_LOG = ws.log;
    t.after(() => delete process.env.XAS_RECALL_TEST_JUDGE_LOG);
    await assert.rejects(runRecall(ws.options), /未注册/);
    assert.equal((await readJudgeRequests(ws.log)).length, 0);
  });
  for (const reserved of [
    "allOf",
    "anyOf",
    "firstOf",
    "allOf.point",
    "anyOf.point",
    "__recall_all_of__:point",
    "__recall_any_of__:point",
  ]) {
    await t.test(reserved, async (t) => {
      const ws = await firstOfWorkspace(t, { "mechanical-a": {} });
      await writeFile(
        ws.registryPath,
        `import base from ${JSON.stringify(ws.registry)};
        export default { ...base, criteria: [...base.criteria, {
          name: ${JSON.stringify(reserved)}, scope: "session",
          evaluate: () => ({ pass: true, score: 1, reason: "x" })
        }] };`,
      );
      process.env.XAS_RECALL_TEST_JUDGE_LOG = ws.log;
      t.after(() => delete process.env.XAS_RECALL_TEST_JUDGE_LOG);
      await assert.rejects(runRecall(ws.options), /保留名/);
      assert.equal((await readJudgeRequests(ws.log)).length, 0);
    });
  }
});
