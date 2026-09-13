/**
 * @module @x-agent-suite/observation/tests/report-diff
 * diffScenarioReports 单元测试：变化检测、lens 注入、场景不匹配与缺行拒绝。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReportDocument } from "@x-agent-suite/contracts";
import {
  diffScenarioReports,
  type ReportDiffLens,
} from "../src/report-diff.ts";

/** 构造最小报告文档。 */
function makeReport(overrides: {
  scenario?: string;
  hardPass?: boolean;
  score?: number;
  states?: Record<string, string>;
  rate?: number;
}): ReportDocument {
  const artifact =
    overrides.score !== undefined || overrides.states
      ? {
          aggregate: {
            score: overrides.score ?? 0,
            dimensions: Object.entries(overrides.states ?? {}).map(
              ([metric, state]) => ({ metric, state }),
            ),
          },
        }
      : undefined;
  return {
    scenario: overrides.scenario ?? "demo/a",
    stamp: "s",
    rows: [
      {
        scenario: overrides.scenario ?? "demo/a",
        carrier: "default",
        promptVariant: "default",
        result: {
          observation: {
            text: "",
            toolCalls: [],
            toolCallsCount: 0,
            events: [],
          },
          artifact,
          dryPass: true,
          hardPass: overrides.hardPass ?? true,
          fuzzyPass: overrides.hardPass ?? true,
          latencyMs: 1,
        },
        ...(overrides.rate !== undefined
          ? {
              repeat: {
                runs: 2,
                hardPassCount: Math.round(overrides.rate * 2),
                hardPassRate: overrides.rate,
                fuzzyPassRate: overrides.rate,
              },
            }
          : {}),
      },
    ],
  } as unknown as ReportDocument;
}

/** RunnerArtifact 形状的演示 lens。 */
const lens: ReportDiffLens = {
  score: (artifact) =>
    (artifact as { aggregate?: { score: number } } | undefined)?.aggregate
      ?.score,
  dimensions: (artifact) =>
    (
      artifact as
        | { aggregate?: { dimensions: { metric: string; state: string }[] } }
        | undefined
    )?.aggregate?.dimensions ?? [],
};

test("无变化：changed=false，无字段", () => {
  const diff = diffScenarioReports(
    makeReport({ score: 0.6, states: { a: "hit" } }),
    makeReport({ score: 0.6, states: { a: "hit" } }),
    lens,
  );
  assert.equal(diff.changed, false);
  assert.equal(diff.dimensions.length, 0);
});

test("维度状态迁移与分数变化被点名", () => {
  const diff = diffScenarioReports(
    makeReport({ hardPass: true, score: 0.8, states: { a: "hit", b: "hit" } }),
    makeReport({
      hardPass: false,
      score: 0.4,
      states: { a: "hit", b: "miss" },
    }),
    lens,
  );
  assert.equal(diff.changed, true);
  assert.deepEqual(diff.hardPass, { before: true, after: false });
  assert.equal(diff.score?.delta.toFixed(1), "-0.4");
  assert.deepEqual(diff.dimensions, [
    { metric: "b", before: "hit", after: "miss" },
  ]);
});

test("稳定率变化；无 lens 时只比契约字段", () => {
  const withRate = diffScenarioReports(
    makeReport({ rate: 1 }),
    makeReport({ rate: 0.5 }),
  );
  assert.deepEqual(withRate.hardPassRate, { before: 1, after: 0.5 });

  const noLens = diffScenarioReports(
    makeReport({ score: 0.8 }),
    makeReport({ score: 0.4 }),
  );
  assert.equal(noLens.score, undefined, "无 lens 不读 artifact");
  assert.equal(noLens.changed, false);
});

test("场景不一致显式抛错", () => {
  assert.throws(
    () =>
      diffScenarioReports(
        makeReport({ scenario: "demo/a" }),
        makeReport({ scenario: "demo/b" }),
      ),
    /场景不一致/,
  );
});
