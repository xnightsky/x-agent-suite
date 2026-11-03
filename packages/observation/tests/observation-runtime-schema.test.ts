/** 聚合运行时 schema 与 OR 引用 reason 回归。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  AggregationSpec,
  CriterionOutcome,
} from "@x-agent-suite/contracts";
import { resolveAggregate } from "../src/aggregation.ts";

function outcome(name: string, pass: boolean): CriterionOutcome {
  return { name, scope: "session", pass, score: pass ? 1 : 0, reason: "" };
}

test("aggregation：非有限 threshold/weight、非法 metric/knockout/absent 显式拒绝", () => {
  const invalid: readonly [unknown, RegExp][] = [
    [null, /对象/],
    [{}, /dimensions/],
    [{ dimensions: null }, /dimensions/],
    [{ dimensions: [], extra: true }, /未知字段/],
    [{ dimensions: [{ metric: "" }] }, /metric/],
    [{ dimensions: [{ metric: [] }] }, /metric/],
    [{ dimensions: [{ metric: ["a", ""] }] }, /metric/],
    [{ dimensions: [{ metric: "a", weight: Number.NaN }] }, /weight/],
    [
      { dimensions: [{ metric: "a", weight: Number.POSITIVE_INFINITY }] },
      /weight/,
    ],
    [{ dimensions: [{ metric: "a", weight: null }] }, /weight/],
    [{ dimensions: [{ metric: "a", knockout: "true" }] }, /knockout/],
    [{ dimensions: [{ metric: "a", absent: "bogus" }] }, /absent/],
    [{ dimensions: [{ metric: "a", absent: null }] }, /absent/],
    [{ dimensions: [{ metric: "a", unknown: true }] }, /未知字段/],
    [{ dimensions: [], threshold: Number.NaN }, /threshold/],
    [{ dimensions: [], threshold: Number.POSITIVE_INFINITY }, /threshold/],
    [{ dimensions: [], threshold: null }, /threshold/],
  ];
  for (const [spec, expected] of invalid) {
    assert.throws(
      () => resolveAggregate([], spec as AggregationSpec),
      expected,
      JSON.stringify(spec),
    );
  }
});

test("aggregation：negative finite weight 暂保持现状，weight=0/空维/负 threshold 不变", () => {
  assert.doesNotThrow(() =>
    resolveAggregate([outcome("a", true)], {
      dimensions: [{ metric: "a", weight: -2 }],
    }),
  );
  const zero = resolveAggregate([outcome("a", true)], {
    dimensions: [{ metric: "a", weight: 0 }],
  });
  assert.equal(zero.pass, true);
  assert.equal(zero.score, 0);
  const empty = resolveAggregate([], { dimensions: [] });
  assert.deepEqual(empty.coverage, { evaluated: 0, total: 0 });
  const negativeThreshold = resolveAggregate([outcome("a", false)], {
    dimensions: [{ metric: "a" }],
    threshold: -1,
  });
  assert.equal(negativeThreshold.pass, true);
});

test("aggregation：OR 中任一未产出引用在 hit/miss 时都进入 reason", () => {
  for (const pass of [true, false]) {
    const result = resolveAggregate([outcome("a", pass)], {
      dimensions: [{ metric: ["a", "groundng"] }],
    });
    assert.match(result.reason, /groundng/);
  }
});
