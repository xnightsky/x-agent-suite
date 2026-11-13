/** 组合断言公共 seam：实际贡献、共同 miss、短路与 ERROR 诊断，零 token。 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateAllOf,
  evaluateAnyOf,
  evaluateFirstOf,
  type CompositionEvent,
} from "../src/index.ts";

const verdict = (pass: boolean, contribution?: number) => ({
  pass,
  score: pass ? 1 : 0,
  reason: pass ? "满足" : "未满足",
  ...(contribution === undefined ? {} : { contribution }),
});

test("allOf 全过并按各分支实际贡献求和", async () => {
  const result = await evaluateAllOf([
    {
      name: "a",
      score: { hit: 2, miss: -1 },
      evaluate: async () => verdict(true),
    },
    {
      name: "b",
      score: { hit: 3, miss: -1 },
      evaluate: async () => verdict(true),
    },
  ]);
  assert.equal(result.kind, "allOf");
  assert.equal(result.pass, true);
  assert.equal(result.score, 1);
  assert.equal(result.contribution, 5);
  assert.equal(result.accepted, null);
  assert.deepEqual(
    result.branches.map((branch) => branch.contribution),
    [2, 3],
  );
});

test("allOf 部分失败仍执行全部、保留 miss=0 且正分不放行", async () => {
  const calls: string[] = [];
  const result = await evaluateAllOf([
    {
      name: "a",
      score: { hit: 2, miss: -1 },
      evaluate: async () => (calls.push("a"), verdict(false)),
    },
    {
      name: "b",
      score: { hit: 3, miss: 0 },
      evaluate: async () => (calls.push("b"), verdict(true)),
    },
    {
      name: "c",
      evaluate: async () => (calls.push("c"), verdict(false, 0)),
    },
  ]);
  assert.deepEqual(calls, ["a", "b", "c"]);
  assert.equal(result.pass, false);
  assert.equal(result.score, 0);
  assert.equal(result.contribution, 2);
  assert.equal(result.branches[0]!.result?.pass, false);
  assert.equal(result.branches[2]!.contribution, 0);
});

test("allOf ERROR 不发布正常结果，未执行分支标记 skipped(error)", async () => {
  let called = false;
  let errorEvent: CompositionEvent | undefined;
  await assert.rejects(
    evaluateAllOf(
      [
        {
          name: "a",
          evaluate: async () => {
            throw new Error("timeout");
          },
        },
        { name: "b", evaluate: async () => ((called = true), verdict(true)) },
      ],
      (event) => {
        if (event.phase === "composition-error") errorEvent = event;
      },
    ),
    /timeout/,
  );
  assert.equal(called, false);
  assert.equal(errorEvent?.result, undefined);
  assert.equal(errorEvent?.branches[0]!.status, "error");
  assert.deepEqual(errorEvent?.branches[1], {
    index: 1,
    name: "b",
    status: "skipped",
    skipReason: "error",
  });
});

test("anyOf 单候选通过与多候选通过取最高实际贡献", async () => {
  const single = await evaluateAnyOf([
    {
      name: "a",
      score: { hit: 1, miss: -2 },
      evaluate: async () => verdict(false),
    },
    {
      name: "b",
      score: { hit: 2, miss: -2 },
      evaluate: async () => verdict(true),
    },
  ]);
  assert.equal(single.pass, true);
  assert.equal(single.accepted, "b");
  assert.equal(single.contribution, 2);

  const multiple = await evaluateAnyOf([
    {
      name: "a",
      score: { hit: 1, miss: -1 },
      evaluate: async () => verdict(true),
    },
    {
      name: "b",
      score: { hit: 3, miss: -1 },
      evaluate: async () => verdict(true),
    },
  ]);
  assert.equal(multiple.accepted, "b");
  assert.equal(multiple.contribution, 3);
  assert.equal(multiple.branches[0]!.result?.pass, true);
});

test("anyOf 同分取声明序，通过不要求正贡献", async () => {
  const tied = await evaluateAnyOf([
    {
      name: "a",
      score: { hit: 0, miss: -1 },
      evaluate: async () => verdict(true),
    },
    {
      name: "b",
      score: { hit: 0, miss: -1 },
      evaluate: async () => verdict(true),
    },
  ]);
  assert.equal(tied.pass, true);
  assert.equal(tied.accepted, "a");
  assert.equal(tied.contribution, 0);

  const negative = await evaluateAnyOf([
    {
      name: "a",
      score: { hit: -2, miss: -1 },
      evaluate: async () => verdict(true),
    },
    {
      name: "b",
      score: { hit: 3, miss: -1 },
      evaluate: async () => verdict(false),
    },
  ]);
  assert.equal(negative.pass, true);
  assert.equal(negative.contribution, -2);
});

test("anyOf 全失败只取一次共同 miss，失败候选不累计", async () => {
  const result = await evaluateAnyOf([
    {
      name: "a",
      score: { hit: 1, miss: -2 },
      evaluate: async () => verdict(false),
    },
    {
      name: "b",
      score: { hit: 3, miss: -2 },
      evaluate: async () => verdict(false),
    },
    {
      name: "c",
      score: { hit: 4, miss: -2 },
      evaluate: async () => verdict(false),
    },
  ]);
  assert.equal(result.pass, false);
  assert.equal(result.accepted, null);
  assert.equal(result.commonMiss, -2);
  assert.equal(result.contribution, -2);
});

test("anyOf 已有 PASS 仍不吞后续 ERROR", async () => {
  let errorEvent: CompositionEvent | undefined;
  await assert.rejects(
    evaluateAnyOf(
      [
        { name: "a", evaluate: async () => verdict(true) },
        {
          name: "b",
          evaluate: async () => {
            throw new Error("judge failed");
          },
        },
      ],
      (event) => {
        if (event.phase === "composition-error") errorEvent = event;
      },
    ),
    /judge failed/,
  );
  assert.equal(errorEvent?.result, undefined);
  assert.equal(errorEvent?.branches[0]!.result?.pass, true);
  assert.equal(errorEvent?.branches[1]!.status, "error");
});

test("firstOf 接受首个正贡献并真正短路后档", async () => {
  let called = false;
  const result = await evaluateFirstOf([
    {
      name: "standard",
      score: { hit: 3, miss: -1 },
      evaluate: async () => verdict(true),
    },
    {
      name: "downgrade",
      score: { hit: 1, miss: -1 },
      evaluate: async () => ((called = true), verdict(true)),
    },
  ]);
  assert.equal(result.pass, true);
  assert.equal(result.accepted, "standard");
  assert.equal(result.contribution, 3);
  assert.equal(called, false);
  assert.equal(result.branches[1]!.skipReason, "accepted-earlier");
});

test("firstOf hit=0 与负 hit 都继续，而不按 raw pass 抢占", async () => {
  for (const hit of [0, -2]) {
    const calls: string[] = [];
    const result = await evaluateFirstOf([
      {
        name: "standard",
        score: { hit, miss: -1 },
        evaluate: async () => (calls.push("standard"), verdict(true)),
      },
      {
        name: "downgrade",
        score: { hit: 1, miss: -1 },
        evaluate: async () => (calls.push("downgrade"), verdict(true)),
      },
    ]);
    assert.deepEqual(calls, ["standard", "downgrade"]);
    assert.equal(result.accepted, "downgrade");
    assert.equal(result.contribution, 1);
    assert.equal(result.branches[0]!.result?.pass, true);
  }
});

test("firstOf 正 miss 可接受原始 false，诊断仍保留 raw false", async () => {
  const result = await evaluateFirstOf([
    {
      name: "observed",
      score: { hit: 3, miss: 2 },
      evaluate: async () => verdict(false),
    },
    {
      name: "unused",
      score: { hit: 1, miss: 2 },
      evaluate: async () => verdict(false),
    },
  ]);
  assert.equal(result.pass, true);
  assert.equal(result.accepted, "observed");
  assert.equal(result.contribution, 2);
  assert.equal(result.branches[0]!.result?.pass, false);
  assert.equal(result.branches[1]!.status, "skipped");
});

test("firstOf 使用分支内部实际贡献，未接受时只取一次共同 miss", async () => {
  const continued = await evaluateFirstOf([
    { name: "a", miss: -3, evaluate: async () => verdict(true, 0) },
    { name: "b", miss: -3, evaluate: async () => verdict(true, 4) },
  ]);
  assert.equal(continued.accepted, "b");
  assert.equal(continued.contribution, 4);
  assert.equal(continued.branches[0]!.scoreSource, "leaves");

  const failed = await evaluateFirstOf([
    { name: "a", miss: -3, evaluate: async () => verdict(false, -1) },
    { name: "b", miss: -3, evaluate: async () => verdict(false, -2) },
  ]);
  assert.equal(failed.pass, false);
  assert.equal(failed.accepted, null);
  assert.equal(failed.commonMiss, -3);
  assert.equal(failed.contribution, -3);
});

test("firstOf ERROR 不降级且后档零请求", async () => {
  let called = false;
  await assert.rejects(
    evaluateFirstOf([
      {
        name: "a",
        evaluate: async () => {
          throw new Error("abort");
        },
      },
      { name: "b", evaluate: async () => ((called = true), verdict(true)) },
    ]),
    /abort/,
  );
  assert.equal(called, false);
});

test("anyOf/firstOf 在执行前拒绝共同 miss 不一致", async () => {
  for (const evaluate of [evaluateAnyOf, evaluateFirstOf]) {
    let called = false;
    await assert.rejects(
      evaluate([
        {
          name: "a",
          score: { miss: -1 },
          evaluate: async () => verdict(false),
        },
        {
          name: "b",
          score: { miss: 0 },
          evaluate: async () => ((called = true), verdict(false)),
        },
      ]),
      /miss/,
    );
    assert.equal(called, false);
  }
});
