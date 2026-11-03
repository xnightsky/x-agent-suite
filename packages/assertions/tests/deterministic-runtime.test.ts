/** tool-call expect 严格形状与递归 JSON 子集匹配回归。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { inputContains, toolCall } from "../src/deterministic.ts";
import { evaluateSync, makeContext, makeTurn } from "./support.ts";

function evaluate(
  expect: unknown,
  input: unknown,
  status: "completed" | "failed" = "completed",
) {
  return evaluateSync(
    toolCall,
    makeTurn("", [{ name: "write", input, status }]),
    makeContext(expect),
  );
}

test("tool-call：action 与 args 的 falsy/非法形状不被当作未声明", () => {
  const invalid: unknown[] = [
    { tool: "write", action: "" },
    { tool: "write", action: null },
    { tool: "write", action: false },
    { tool: "write", args: null },
    { tool: "write", args: [] },
    { tool: "write", args: "ab" },
    { tool: "write", actionn: "create" },
    { tool: "write", args: { x: Number.NaN } },
    { tool: "write", args: { x: Number.POSITIVE_INFINITY } },
  ];
  for (const expect of invalid) {
    assert.throws(
      () => evaluate(expect, {}),
      /tool-call|action|args|未知字段|有限/,
      JSON.stringify(expect),
    );
  }
});

test("tool-call：递归子集匹配忽略对象键序但区分数组/对象", () => {
  assert.equal(
    evaluate(
      { tool: "write", args: { opts: { a: 1, b: 2 } } },
      { opts: { b: 2, a: 1 }, extra: true },
    ).pass,
    true,
  );
  assert.equal(
    evaluate({ tool: "write", args: { a: { 0: "x" } } }, { a: ["x"] }).pass,
    false,
  );
  assert.equal(
    evaluate(
      { tool: "write", args: { files: [{ a: 1, b: 2 }] } },
      { files: [{ b: 2, a: 1 }] },
    ).pass,
    true,
  );
});

test("tool-call：继承属性与非 JSON 实际值不构成匹配", () => {
  const inherited = Object.create({ path: "a" }) as Record<string, unknown>;
  inherited.other = true;
  assert.equal(
    evaluate({ tool: "write", args: { path: "a" } }, inherited).pass,
    false,
  );
  assert.equal(inputContains({ x: Number.NaN } as never, { x: null }), false);
  assert.equal(inputContains({ x: null }, { x: Number.NaN } as never), false);
});
