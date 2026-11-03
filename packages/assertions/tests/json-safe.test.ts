/** JSON-safe 原语：值域、深克隆、深相等与 own-property 子集语义。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { assertJsonValue, cloneJsonValue } from "../src/index.ts";
import { isJsonValue, jsonContains, jsonEqual } from "../src/json-safe.ts";

test("json-safe：接受普通 JSON 与 null-prototype 对象", () => {
  const nullProto = Object.create(null) as Record<string, unknown>;
  nullProto.nested = [1, true, null, { value: "x" }];
  const values: unknown[] = [
    null,
    true,
    false,
    0,
    -1.5,
    "",
    "text",
    [1, { a: 2 }],
    { a: 1, nested: { ok: true } },
    nullProto,
  ];
  for (const value of values) {
    assert.doesNotThrow(() => assertJsonValue(value));
    assert.equal(isJsonValue(value), true);
  }
});

test("json-safe：拒绝非 JSON、循环、稀疏数组和不可枚举字段", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const accessor = {};
  Object.defineProperty(accessor, "value", {
    enumerable: true,
    get: () => 1,
  });
  const symbolKey = { ok: true };
  Object.defineProperty(symbolKey, Symbol("secret"), {
    enumerable: true,
    value: 1,
  });
  const hidden = {};
  Object.defineProperty(hidden, "secret", {
    enumerable: false,
    value: "HIDDEN_VALUE",
  });
  const invalid: unknown[] = [
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    () => 1,
    1n,
    new Date(),
    new Map([["k", "v"]]),
    new Set(["v"]),
    { nested: undefined },
    { fn: () => 1 },
    { symbolValue: Symbol("value") },
    [, 1],
    cyclic,
    accessor,
    symbolKey,
    hidden,
  ];
  for (const value of invalid) {
    assert.throws(
      () => assertJsonValue(value),
      /JSON|有限|循环|数组|对象|属性/,
    );
    assert.equal(isJsonValue(value), false);
  }
});

test("json-safe：克隆独立且保留 __proto__ 自有键", () => {
  const source = JSON.parse('{"__proto__":{"safe":true},"arr":[{"a":1}]}') as {
    __proto__: { safe: boolean };
    arr: { a: number }[];
  };
  const cloned = cloneJsonValue<typeof source>(source);
  assert.notEqual(cloned, source);
  assert.notEqual(cloned.arr, source.arr);
  assert.notEqual(cloned.arr[0], source.arr[0]);
  assert.ok(Object.hasOwn(cloned, "__proto__"));
  assert.deepEqual(cloned, source);
  cloned.arr[0]!.a = 9;
  assert.equal(source.arr[0]!.a, 1);
});

test("json-safe：深相等忽略对象键序并保留数组顺序", () => {
  assert.equal(
    jsonEqual(
      { a: 1, nested: { x: 1, y: [2, { p: 3, q: 4 }] } },
      { nested: { y: [2, { q: 4, p: 3 }], x: 1 }, a: 1 },
    ),
    true,
  );
  assert.equal(jsonEqual([1, 2], [2, 1]), false);
  assert.equal(jsonEqual({ a: 1 }, [1]), false);
});

test("json-safe：子集匹配只看 own property 且区分对象/数组", () => {
  assert.equal(
    jsonContains(
      { nested: { x: 1, y: 2 }, extra: true },
      { nested: { y: 2, x: 1 } },
    ),
    true,
  );
  const inherited = Object.create({ path: "a" }) as Record<string, unknown>;
  inherited.other = 1;
  assert.equal(jsonContains(inherited, { path: "a" }), false);
  assert.equal(jsonContains({ a: ["x"] }, { a: { 0: "x" } }), false);
  assert.equal(jsonContains({}, { missing: undefined as never }), false);
});

test("json-safe：错误信息不回显非法值", () => {
  assert.throws(
    () =>
      assertJsonValue(
        { secret: "DO_NOT_ECHO_VALUE", invalid: Number.NaN },
        "root",
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /DO_NOT_ECHO_VALUE/);
      return true;
    },
  );
});
