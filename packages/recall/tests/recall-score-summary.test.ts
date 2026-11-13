/** repeat/suite 计分汇总：有效次数、null、宏平均与 pass@k/pass^k。 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  summarizeRecallRepeatScores,
  summarizeRecallSuiteScores,
} from "../src/index.ts";

test("repeat 分别披露 valid/invalid/skipped、分数范围与两种 k 统计", () => {
  const summary = summarizeRecallRepeatScores(
    5,
    [
      { hardPass: true, rawScore: 2 },
      { hardPass: false, rawScore: -1 },
      { hardPass: true, rawScore: 4 },
    ],
    { invalid: 1, skipped: 1 },
  );
  assert.deepEqual(summary, {
    planned: 5,
    valid: 3,
    invalid: 1,
    skipped: 1,
    coverage: 3 / 5,
    invalidRate: 1 / 5,
    passRate: 2 / 3,
    rawScore: { mean: 5 / 3, min: -1, max: 4 },
    passAtK: true,
    passAllK: false,
  });
});

test("无有效 repeat 时行为与分数为 null，passAllK 不制造成立", () => {
  const summary = summarizeRecallRepeatScores(2, [], {
    invalid: 1,
    skipped: 1,
  });
  assert.deepEqual(summary, {
    planned: 2,
    valid: 0,
    invalid: 1,
    skipped: 1,
    coverage: 0,
    invalidRate: 0.5,
    passRate: null,
    rawScore: null,
    passAtK: null,
    passAllK: false,
  });
});

test("有有效 repeat 但无断言时 rawScore=null，行为统计仍可用", () => {
  const summary = summarizeRecallRepeatScores(2, [
    { hardPass: true, rawScore: null },
    { hardPass: true, rawScore: null },
  ]);
  assert.equal(summary.valid, 2);
  assert.equal(summary.passRate, 1);
  assert.equal(summary.rawScore, null);
  assert.equal(summary.passAtK, true);
  assert.equal(summary.passAllK, true);
});

test("suite 按 target×case 宏平均，不按 repeat 数加权", () => {
  const longCase = summarizeRecallRepeatScores(3, [
    { hardPass: true, rawScore: 3 },
    { hardPass: true, rawScore: 3 },
    { hardPass: false, rawScore: 0 },
  ]);
  const shortCase = summarizeRecallRepeatScores(1, [
    { hardPass: true, rawScore: 9 },
  ]);
  const summary = summarizeRecallSuiteScores(3, [longCase, shortCase], {
    invalid: 1,
  });
  assert.deepEqual(summary, {
    planned: 3,
    valid: 2,
    invalid: 1,
    skipped: 0,
    coverage: 2 / 3,
    invalidRate: 1 / 3,
    passRate: (2 / 3 + 1) / 2,
    rawScore: 5.5,
    passAtK: 1,
    passAllK: 0.5,
  });
});

test("suite 没有有效 case 时保留 coverage/invalidRate，其余为 null", () => {
  const summary = summarizeRecallSuiteScores(3, [], {
    invalid: 1,
    skipped: 2,
  });
  assert.deepEqual(summary, {
    planned: 3,
    valid: 0,
    invalid: 1,
    skipped: 2,
    coverage: 0,
    invalidRate: 1 / 3,
    passRate: null,
    rawScore: null,
    passAtK: null,
    passAllK: null,
  });
});
