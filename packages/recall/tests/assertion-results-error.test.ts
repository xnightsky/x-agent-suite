/** Recall 投影保留 aggregate/runner 已有 error 的回归。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScenarioResult, ScenarioSpec } from "@x-agent-suite/contracts";
import type { RunnerArtifact } from "@x-agent-suite/runner";
import { adaptRecallAssertionResult } from "../src/assertion-results.ts";

function result(
  error: string | undefined,
  hardPass = false,
  outcomePass = true,
): ScenarioResult<RunnerArtifact> {
  return {
    observation: {
      text: "",
      toolCalls: [],
      toolCallsCount: 0,
      events: [{ type: "text", timestamp: 1 }],
    },
    artifact: {
      outcomes: [
        {
          name: "m",
          scope: "turn",
          turnIndex: 0,
          pass: outcomePass,
          score: outcomePass ? 1 : 0,
          reason: outcomePass ? "ok" : "bad",
        },
      ],
    },
    dryPass: true,
    hardPass,
    fuzzyPass: true,
    latencyMs: 1,
    ...(error === undefined ? {} : { error }),
  };
}

const spec: ScenarioSpec = {
  id: "suite/error",
  turns: [{ send: "x", expect: { m: true } }],
  metadata: {},
};

test("adaptRecallAssertionResult：优先保留已有 result.error", () => {
  const aggregateReason = "未通过；coverage 1/2；knockout 维度未命中，整体否决";
  const adapted = adaptRecallAssertionResult(spec, result(aggregateReason));
  assert.equal(adapted.hardPass, false);
  assert.equal(adapted.error, aggregateReason);
});

test("adaptRecallAssertionResult：缺失 error 时回退 failed assertions，空串也回退", () => {
  for (const error of [undefined, ""]) {
    const adapted = adaptRecallAssertionResult(
      spec,
      result(error, false, false),
    );
    assert.ok(adapted.error);
    assert.match(adapted.error, /m: bad/);
  }
});
