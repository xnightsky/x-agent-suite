/**
 * @module @x-agent-suite/matrix/tests/matrix
 * Matrix 编排层单元测试：使用 mock driver / scenario / variant 发现，
 * 验证变体串行、carrier 并行、skip 降级与报告转换。
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type {
  AgentDriver,
  Observation,
  ScenarioResult,
} from "@x-agent-suite/contracts";
import {
  runMatrix,
  toScenarioReportRows,
  writeScenarioReports,
} from "@x-agent-suite/matrix";

function makeObservation(text = ""): Observation {
  return { text, toolCalls: [], toolCallsCount: 0, events: [] };
}

function makeResult(pass: boolean, text = ""): ScenarioResult {
  return {
    observation: makeObservation(text),
    artifact: {},
    dryPass: pass,
    hardPass: pass,
    fuzzyPass: pass,
    latencyMs: 10,
  };
}

function makeMockDriver(id: string, failOnSend = false): AgentDriver {
  return {
    start: async () => {},
    sendPrompt: async () => {
      if (failOnSend) {
        throw new Error(`driver ${id} send failed`);
      }
      return makeObservation(`ok-${id}`);
    },
    events: async function* () {},
    close: async () => {},
  };
}

test("runMatrix：变体串行、carrier 并行，返回结果与计数", async () => {
  const runs: string[] = [];
  const result = await runMatrix(
    {
      carriers: ["a", "b"],
      getVariants: () => ["v1", "v2"],
      createDriver: async (carrier) => makeMockDriver(carrier),
      runScenario: async ({ scenarioId, carrier, promptVariant, driver }) => {
        runs.push(`${scenarioId}/${carrier}/${promptVariant}`);
        const obs = await driver.sendPrompt("hi");
        return makeResult(true, obs.text);
      },
    },
    { scenarioId: "s1" },
  );

  assert.equal(result.okCount, 4);
  assert.equal(result.skipCount, 0);
  assert.equal(result.failCount, 0);
  assert.deepEqual(
    runs.sort(),
    ["s1/a/v1", "s1/a/v2", "s1/b/v1", "s1/b/v2"].sort(),
  );
});

test("runMatrix：driver 创建失败 → skip 行，不影响其他 carrier", async () => {
  const result = await runMatrix(
    {
      carriers: ["good", "bad"],
      getVariants: () => ["v1"],
      createDriver: async (carrier) => {
        if (carrier === "bad") {
          throw new Error("bad driver unavailable");
        }
        return makeMockDriver(carrier);
      },
      runScenario: async ({ driver }) =>
        makeResult(true, (await driver.sendPrompt("")).text),
    },
    { scenarioId: "s2" },
  );

  assert.equal(result.okCount, 1);
  assert.equal(result.skipCount, 1);
  assert.equal(result.failCount, 0);
  const skip = result.rows.find((r) => r.kind === "skip");
  assert.ok(skip);
  assert.match(skip!.reason, /bad driver unavailable/);
});

test("runMatrix：skip 原因写入行前应用通用 redactor", async () => {
  const secret = "synthetic-matrix-secret";
  const result = await runMatrix(
    {
      carriers: ["bad"],
      getVariants: () => ["v1"],
      createDriver: async () => ({
        ...makeMockDriver("redaction"),
        redactor: (text) => text.replaceAll(secret, "[REDACTED]"),
      }),
      runScenario: async () => {
        throw new AggregateError(
          [new Error(`nested=${secret}`)],
          `run=${secret}`,
        );
      },
    },
    { scenarioId: "redaction" },
  );

  const skip = result.rows[0];
  assert.equal(skip?.kind, "skip");
  assert.doesNotMatch((skip as { reason: string }).reason, new RegExp(secret));
  assert.match((skip as { reason: string }).reason, /\[REDACTED\]/);

  const outDir = await mkdtemp(join(os.tmpdir(), "xas-matrix-redact-"));
  try {
    const paths = await writeScenarioReports(
      toScenarioReportRows(result.rows),
      {
        scenarioId: "redaction",
        outDir,
        stamp: "safe",
      },
    );
    const output = `${await readFile(paths.mdPath, "utf8")}\n${await readFile(paths.jsonPath, "utf8")}`;
    assert.doesNotMatch(output, new RegExp(secret));
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("runMatrix：runScenario 抛错 → skip 行", async () => {
  const result = await runMatrix(
    {
      carriers: ["a"],
      getVariants: () => ["v1"],
      createDriver: async () => makeMockDriver("a"),
      runScenario: async () => {
        throw new Error("scenario boom");
      },
    },
    { scenarioId: "s3" },
  );

  assert.equal(result.okCount, 0);
  assert.equal(result.skipCount, 1);
  const skip = result.rows[0];
  assert.equal(skip?.kind, "skip");
  assert.match((skip as { reason: string }).reason, /scenario boom/);
});

test("runMatrix：driver.close 失败时不得保留 ok 行", async () => {
  const driver = makeMockDriver("close-failure");
  driver.close = async () => {
    throw new Error("close boom");
  };
  const result = await runMatrix(
    {
      carriers: ["a"],
      getVariants: () => ["v1"],
      createDriver: async () => driver,
      runScenario: async () => makeResult(true),
    },
    { scenarioId: "s-close" },
  );

  assert.equal(result.okCount, 0);
  assert.equal(result.skipCount, 1);
  assert.equal(result.rows[0]?.kind, "skip");
  assert.match((result.rows[0] as { reason: string }).reason, /close boom/);
});

test("toScenarioReportRows：ok 行与 skip 行均转换为 ScenarioReportRow", () => {
  const rows = [
    {
      kind: "ok" as const,
      scenarioId: "s",
      carrier: "a",
      promptVariant: "v1",
      result: makeResult(true, "done"),
    },
    {
      kind: "skip" as const,
      scenarioId: "s",
      carrier: "b",
      promptVariant: "v1",
      reason: " unavailable",
    },
  ];
  const reportRows = toScenarioReportRows(rows);
  assert.equal(reportRows.length, 2);
  assert.equal(reportRows[0]!.result.hardPass, true);
  assert.equal(reportRows[1]!.result.hardPass, false);
  assert.equal(reportRows[1]!.result.error, " unavailable");
});

test("writeScenarioReports：md + json 落盘", async () => {
  const dir = await mkdtemp(join(os.tmpdir(), "xas-matrix-report-"));
  const rows = toScenarioReportRows([
    {
      kind: "ok",
      scenarioId: "s",
      carrier: "a",
      promptVariant: "v1",
      result: makeResult(true, "done"),
    },
  ]);
  try {
    const paths = await writeScenarioReports(rows, {
      scenarioId: "s",
      outDir: dir,
      stamp: "2026",
    });
    assert.match(paths.mdPath, /2026-s-report\.md$/);
    assert.match(paths.jsonPath, /2026-s-report\.json$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
