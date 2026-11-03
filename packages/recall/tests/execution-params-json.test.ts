/** executionParams 严格 JSON-safe 校验与独立克隆回归。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { copyExecutionParams } from "../src/execution-params.ts";

test("executionParams：拒绝 NaN/Infinity/undefined/函数/非普通对象/稀疏数组/循环", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const sparse = [1];
  sparse.length = 2;
  const invalid: unknown[] = [
    { x: Number.NaN },
    { x: Number.POSITIVE_INFINITY },
    { nested: [undefined] },
    { fn: () => 1 },
    { date: new Date() },
    { map: new Map() },
    { set: new Set() },
    { sparse },
    { cyclic },
  ];
  for (const value of invalid) {
    assert.throws(
      () => copyExecutionParams(value),
      /executionParams|JSON/,
      String(value),
    );
  }
});

test("executionParams：错误不回显输入值", () => {
  assert.throws(
    () => copyExecutionParams({ secret: "DO_NOT_ECHO_PARAM", x: Number.NaN }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /DO_NOT_ECHO_PARAM/);
      return true;
    },
  );
});

test("executionParams：克隆独立并保留 own __proto__ 键", () => {
  const input = JSON.parse(
    '{"__proto__":{"safe":true},"nested":{"items":[{"x":1}]}}',
  ) as Record<string, unknown>;
  const parsed = copyExecutionParams(input) as Record<string, unknown>;
  assert.notEqual(parsed, input);
  assert.ok(Object.hasOwn(parsed, "__proto__"));
  assert.deepEqual(parsed.__proto__, { safe: true });
  assert.notEqual(parsed.nested, input.nested);
  (parsed.nested as { items: Array<{ x: number }> }).items[0]!.x = 9;
  assert.equal(
    (input.nested as { items: Array<{ x: number }> }).items[0]!.x,
    1,
  );
});
