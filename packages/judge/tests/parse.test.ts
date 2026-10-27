import assert from "node:assert/strict";
import test from "node:test";
import { JudgeModelError } from "../src/types.ts";
import { parseJudgeResponse } from "../src/parse.ts";

const rubrics = [
  { name: "ownership", rubric: "归属正确" },
  { name: "concise", rubric: "表达简洁" },
] as const;

test("解析规范对象、boolean 与字符串简写并保持 rubric 顺序", () => {
  const parsed = parseJudgeResponse(
    JSON.stringify({
      concise: "yes",
      ownership: { pass: false, reason: "归属错误" },
      unknown: { pass: true, score: 100 },
    }),
    rubrics,
  );
  assert.deepEqual(parsed, {
    verdicts: [
      { name: "ownership", pass: false, reason: "归属错误" },
      { name: "concise", pass: true, reason: "" },
    ],
    absent: [],
  });
  assert.equal("score" in parsed, false);
});

test("容忍围栏、前后散文、嵌套对象与字符串内 braces", () => {
  const fence = String.fromCharCode(96, 96, 96);
  const parsed = parseJudgeResponse(
    "前言 " +
      fence +
      'json\n{"ownership":{"pass":true,"reason":"含 } 与 { 的说明","meta":{"x":1}},"concise":{"pass":"PASS"}}\n' +
      fence +
      " 后文",
    rubrics,
  );
  assert.equal(parsed.verdicts[0]?.reason, "含 } 与 { 的说明");
  assert.equal(parsed.verdicts[1]?.pass, true);
});

test("单项缺失或无法识别进入 absent，全 absent 仍是 completed 数据", () => {
  const parsed = parseJudgeResponse(
    JSON.stringify({ ownership: { pass: "false" }, concise: { score: 0 } }),
    rubrics,
  );
  assert.deepEqual(parsed, { verdicts: [], absent: ["ownership", "concise"] });
});

test("缺 JSON、坏 JSON、数组根与非对象根都是整体 parse 失败", () => {
  for (const text of ["无 JSON", "{bad}", "[]", "null", "true"]) {
    assert.throws(
      () => parseJudgeResponse(text, rubrics),
      (error: unknown) =>
        error instanceof JudgeModelError && error.kind === "parse",
    );
  }
});
