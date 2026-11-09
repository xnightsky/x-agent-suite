/** 有序择档原语：短路、单次贡献与错误不降级，零 token。 */
import assert from "node:assert/strict";
import test from "node:test";
import { evaluateFirstOf } from "../src/first-of.ts";
const verdict = (pass: boolean) => ({
  pass,
  score: pass ? 1 : 0,
  reason: pass ? "满足" : "未满足",
});
for (const [passes, expected] of [
  [[true, true], 3],
  [[false, true], 1],
  [[false, false], -1],
] as const) {
  test(`择档 ${passes}: ${expected}`, async () => {
    const calls: number[] = [];
    const result = await evaluateFirstOf(
      passes.map((pass, index) => ({
        name: String(index),
        score: { hit: index === 0 ? 3 : 1, miss: -1 },
        evaluate: async () => {
          calls.push(index);
          return verdict(pass);
        },
      })),
    );
    assert.equal(result.contribution, expected);
    assert.equal(result.pass, passes.some(Boolean));
    assert.deepEqual(calls, passes[0] ? [0] : [0, 1]);
    if (passes[0])
      assert.deepEqual(result.branches[1], {
        index: 1,
        name: "1",
        status: "skipped",
        skipReason: "accepted-earlier",
      });
  });
}
test("执行错误不触发低档且保留错误阶段", async () => {
  let called = false;
  const stages: string[] = [];
  await assert.rejects(
    evaluateFirstOf(
      [
        {
          name: "a",
          evaluate: async () => {
            throw new Error("timeout");
          },
        },
        {
          name: "b",
          evaluate: async () => {
            called = true;
            return verdict(true);
          },
        },
      ],
      (event) => {
        stages.push(event.phase);
      },
    ),
    /timeout/,
  );
  assert.equal(called, false);
  assert.ok(stages.includes("composition-error"));
});
test("共同 miss 和非法结果均显式拒绝", async () => {
  await assert.rejects(
    evaluateFirstOf([
      { name: "a", score: { miss: 0 }, evaluate: async () => verdict(false) },
      { name: "b", evaluate: async () => verdict(true) },
    ]),
    /miss/,
  );
  let called = false;
  await assert.rejects(
    evaluateFirstOf([
      {
        name: "a",
        evaluate: async () => ({ pass: false, score: 2, reason: "畸形" }),
      },
      {
        name: "b",
        evaluate: async () => {
          called = true;
          return verdict(true);
        },
      },
    ]),
    /score/,
  );
  assert.equal(called, false);
});
test("监听器失败不阻断内部 ERROR 记录，不触发后档", async () => {
  const phases: string[] = [];
  let called = false;
  await assert.rejects(
    evaluateFirstOf(
      [
        { name: "a", evaluate: async () => verdict(true) },
        {
          name: "b",
          evaluate: async () => {
            called = true;
            return verdict(true);
          },
        },
      ],
      (event) => {
        phases.push(event.phase);
        if (event.phase === "branch-skipped") throw new Error("listener");
      },
    ),
    /诊断|通知|listener/,
  );
  assert.equal(called, false);
  assert.ok(phases.includes("composition-error"));
});
