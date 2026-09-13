/**
 * @module @x-agent-suite/observation/tests/observation-aggregation
 * resolveAggregate 单元测试：三态映射、knockout 短路、负分、coverage、threshold、缺省表。
 * 设计权威：docs/spec/scoring-aggregation.md。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  AggregationSpec,
  CriterionOutcome,
} from "@x-agent-suite/contracts";
import { resolveAggregate } from "../src/aggregation.ts";

/** 构造一条具名判据结果（session scope，最简形态）。 */
function makeOutcome(name: string, pass: boolean): CriterionOutcome {
  return { name, scope: "session", pass, score: pass ? 1 : 0, reason: "" };
}

/** 单维声明的快捷构造。 */
function singleDim(
  spec: Partial<AggregationSpec["dimensions"][number]> & {
    metric: AggregationSpec["dimensions"][number]["metric"];
  },
  extra: Omit<AggregationSpec, "dimensions"> = {},
): AggregationSpec {
  return { dimensions: [spec], ...extra };
}

// ---------- 三态映射 ----------

test("三态：判据全过为 hit，贡献 +weight（缺省 1）", () => {
  const result = resolveAggregate(
    [makeOutcome("a", true)],
    singleDim({ metric: "a" }),
  );
  assert.equal(result.dimensions[0]!.state, "hit");
  assert.equal(result.dimensions[0]!.contribution, 1);
  assert.equal(result.rawScore, 1);
  assert.equal(result.maxScore, 1);
  assert.equal(result.score, 1);
  assert.equal(result.pass, true);
});

test("三态：同名多结果有一个 fail 即 miss（严格口径），贡献 −weight", () => {
  const result = resolveAggregate(
    [makeOutcome("a", true), makeOutcome("a", false)],
    singleDim({ metric: "a", weight: 2 }),
  );
  assert.equal(result.dimensions[0]!.state, "miss");
  assert.equal(result.dimensions[0]!.contribution, -2);
  assert.equal(result.score, -1);
  assert.equal(result.pass, false);
});

test("三态：名下无任何结果为 absent，缺省 zero 映射贡献 0 且不计入 maxScore", () => {
  const result = resolveAggregate([], singleDim({ metric: "ghost" }));
  assert.equal(result.dimensions[0]!.state, "absent");
  assert.equal(result.dimensions[0]!.contribution, 0);
  assert.equal(result.maxScore, 0);
  assert.equal(result.score, 0);
});

// ---------- metric 数组（OR） ----------

test("OR：任一引用命中即本维 hit", () => {
  const result = resolveAggregate(
    [makeOutcome("a", false), makeOutcome("b", true)],
    singleDim({ metric: ["a", "b"] }),
  );
  assert.equal(result.dimensions[0]!.state, "hit");
  assert.equal(result.pass, true);
});

test("OR：引用都有结果但无一命中 → miss", () => {
  const result = resolveAggregate(
    [makeOutcome("a", false), makeOutcome("b", false)],
    singleDim({ metric: ["a", "b"] }),
  );
  assert.equal(result.dimensions[0]!.state, "miss");
});

test("OR：引用全部无结果 → absent；部分有结果但无一命中 → miss", () => {
  const allAbsent = resolveAggregate([], singleDim({ metric: ["a", "b"] }));
  assert.equal(allAbsent.dimensions[0]!.state, "absent");
  const partial = resolveAggregate(
    [makeOutcome("a", false)],
    singleDim({ metric: ["a", "b"] }),
  );
  assert.equal(partial.dimensions[0]!.state, "miss");
});

// ---------- absent 映射 ----------

test("absent: pass 视为命中（+weight 且计入 maxScore）", () => {
  const result = resolveAggregate(
    [],
    singleDim({ metric: "a", weight: 3, absent: "pass" }),
  );
  assert.equal(result.dimensions[0]!.state, "absent");
  assert.equal(result.dimensions[0]!.contribution, 3);
  assert.equal(result.maxScore, 3);
  assert.equal(result.score, 1);
});

test("absent: fail 视为未命中（−weight 且计入 maxScore）", () => {
  const result = resolveAggregate(
    [],
    singleDim({ metric: "a", weight: 3, absent: "fail" }),
  );
  assert.equal(result.dimensions[0]!.contribution, -3);
  assert.equal(result.maxScore, 3);
  assert.equal(result.score, -1);
});

// ---------- knockout ----------

test("knockout：该维 miss 时整体 FAIL，压过其他维全命中", () => {
  const result = resolveAggregate(
    [makeOutcome("critical", false), makeOutcome("bonus", true)],
    {
      dimensions: [
        { metric: "critical", knockout: true },
        { metric: "bonus", weight: 10 },
      ],
    },
  );
  assert.equal(result.pass, false);
  assert.ok(result.rawScore > 0, "累加为正仍被 knockout 否决");
});

test("knockout：absent→zero 同样触发（映射后非命中）", () => {
  const result = resolveAggregate(
    [],
    singleDim({ metric: "a", knockout: true }),
  );
  assert.equal(result.pass, false);
});

test("knockout：absent→pass 不触发", () => {
  const result = resolveAggregate(
    [],
    singleDim({ metric: "a", knockout: true, absent: "pass" }),
  );
  assert.equal(result.pass, true);
});

// ---------- threshold ----------

test("threshold：归一分过线即 pass，不过线即 fail", () => {
  const outcomes = [makeOutcome("a", true), makeOutcome("b", false)];
  const spec: AggregationSpec = {
    dimensions: [{ metric: "a" }, { metric: "b" }],
    threshold: 0.5,
  };
  const result = resolveAggregate(outcomes, spec);
  assert.equal(result.rawScore, 0);
  assert.equal(result.score, 0);
  assert.equal(result.pass, false);
  assert.equal(
    resolveAggregate(outcomes, { ...spec, threshold: 0 }).pass,
    true,
  );
});

test("threshold 省略时：计入维全部命中才 pass", () => {
  const outcomes = [makeOutcome("a", true), makeOutcome("b", true)];
  const spec: AggregationSpec = {
    dimensions: [{ metric: "a" }, { metric: "b" }],
  };
  assert.equal(resolveAggregate(outcomes, spec).pass, true);
  assert.equal(
    resolveAggregate([outcomes[0]!, makeOutcome("b", false)], spec).pass,
    false,
  );
});

// ---------- coverage 与边界 ----------

test("coverage：evaluated 只计映射前非缺席维", () => {
  const result = resolveAggregate([makeOutcome("a", true)], {
    dimensions: [{ metric: "a" }, { metric: "ghost" }],
  });
  assert.deepEqual(result.coverage, { evaluated: 1, total: 2 });
});

test("空考：全部缺席时 score=0 且 reason 显式声明无在场维度", () => {
  const result = resolveAggregate([], {
    dimensions: [{ metric: "a" }, { metric: "b" }],
  });
  assert.equal(result.score, 0);
  assert.equal(result.coverage.evaluated, 0);
  assert.match(result.reason, /无在场维度/);
});

test("引用完整性：未知名按 absent 处理且 reason 逐个点名", () => {
  const result = resolveAggregate([makeOutcome("a", true)], {
    dimensions: [{ metric: "a" }, { metric: "groundng" }],
  });
  assert.equal(result.dimensions[1]!.state, "absent");
  assert.match(result.reason, /groundng/);
});

test("负分不截断：多 miss 累加后归一分可为负", () => {
  const result = resolveAggregate(
    [makeOutcome("a", false), makeOutcome("b", false)],
    { dimensions: [{ metric: "a" }, { metric: "b" }] },
  );
  assert.equal(result.rawScore, -2);
  assert.equal(result.score, -1);
});

// ---------- 对抗性边界 ----------

test("threshold 与负分：score=-1 时 threshold=-0.5 不过线，threshold=-1 恰好过线（闭区间）", () => {
  const outcomes = [makeOutcome("a", false), makeOutcome("b", false)];
  const spec: AggregationSpec = {
    dimensions: [{ metric: "a" }, { metric: "b" }],
    threshold: -0.5,
  };
  assert.equal(resolveAggregate(outcomes, spec).pass, false);
  assert.equal(
    resolveAggregate(outcomes, { ...spec, threshold: -1 }).pass,
    true,
  );
});

test("weight=0：命中不加分、分母不加权，但计入参与维（缺省 pass 规则仍看它）", () => {
  const hit = resolveAggregate([makeOutcome("a", true)], {
    dimensions: [{ metric: "a", weight: 0 }],
  });
  assert.equal(hit.maxScore, 0);
  assert.equal(hit.score, 0);
  assert.equal(hit.pass, true);
  const miss = resolveAggregate([makeOutcome("a", false)], {
    dimensions: [{ metric: "a", weight: 0 }],
  });
  assert.equal(miss.pass, false);
});

test("空 dimensions：coverage 0/0，score=0，reason 警示空考", () => {
  const result = resolveAggregate([], { dimensions: [] });
  assert.deepEqual(result.coverage, { evaluated: 0, total: 0 });
  assert.equal(result.score, 0);
  assert.match(result.reason, /无在场维度/);
});

test("同一 metric 被两个维度重复引用：各自独立计分", () => {
  const result = resolveAggregate([makeOutcome("a", true)], {
    dimensions: [
      { metric: "a", weight: 2 },
      { metric: "a", weight: 3 },
    ],
  });
  assert.equal(result.rawScore, 5);
  assert.equal(result.maxScore, 5);
  assert.deepEqual(result.coverage, { evaluated: 2, total: 2 });
});
