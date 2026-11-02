/** JudgeOutcome 到逐 rubric 原始断言结果的通用适配测试。 */
import assert from "node:assert/strict";
import test from "node:test";
import { judgeAssertionResults } from "../src/index.ts";

test("批量裁定逐项保留名称、boolean、reason 与原始 0/1", () => {
  const results = judgeAssertionResults(
    {
      status: "completed",
      verdicts: [
        { name: "a", pass: true, reason: "甲通过" },
        { name: "b", pass: false, reason: "乙未通过" },
      ],
      absent: [],
      attempts: 1,
    },
    "case-judge",
  );
  assert.deepEqual(results, [
    { name: "a", pass: true, score: 1, reason: "甲通过" },
    { name: "b", pass: false, score: 0, reason: "乙未通过" },
  ]);
});

test("缺裁定与整体不可评测保持显式错误", () => {
  assert.throws(
    () =>
      judgeAssertionResults(
        { status: "completed", verdicts: [], absent: ["b"], attempts: 1 },
        "case-judge",
      ),
    /\[absent\].*case-judge.*b/,
  );
  assert.throws(
    () =>
      judgeAssertionResults(
        {
          status: "not-evaluated",
          failure: { kind: "parse", message: "bad json" },
          attempts: 1,
        },
        "case-judge",
      ),
    /\[not-evaluated:parse\].*case-judge/,
  );
});
