/** 报告 JSON 严格性、脱敏 own 键与 0600 权限回归。 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ScenarioReportRow } from "../src/report.ts";
import { writeScenarioReports } from "../src/report.ts";

function makeRow(artifact: Record<string, unknown> = {}): ScenarioReportRow {
  return {
    scenario: "send-message",
    carrier: "fixture-carrier",
    promptVariant: "concise",
    result: {
      observation: {
        text: "ok",
        toolCalls: [],
        toolCallsCount: 0,
        events: [{ type: "prompt", timestamp: 1 }],
      },
      artifact,
      dryPass: true,
      hardPass: true,
      fuzzyPass: true,
      latencyMs: 1,
    },
  };
}

test("report：redact 保留 own __proto__ 键", async () => {
  const outDir = await mkdtemp(join(os.tmpdir(), "obs-report-proto-"));
  const artifact = JSON.parse(
    '{"__proto__":{"safe":true},"keep":"ok"}',
  ) as Record<string, unknown>;
  try {
    const { jsonPath } = await writeScenarioReports([makeRow(artifact)], {
      scenarioId: "proto",
      outDir,
      stamp: "safe",
      redact: (text) => text,
    });
    const report = JSON.parse(await readFile(jsonPath, "utf8")) as {
      rows: Array<{ result: { artifact: Record<string, unknown> } }>;
    };
    const output = report.rows[0]!.result.artifact;
    assert.ok(Object.hasOwn(output, "__proto__"));
    assert.deepEqual(output.__proto__, { safe: true });
    assert.equal(output.keep, "ok");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("report：NaN/Infinity 在写盘前显式拒绝", async () => {
  const outDir = await mkdtemp(join(os.tmpdir(), "obs-report-json-"));
  try {
    for (const artifact of [
      { x: Number.NaN },
      { x: Number.POSITIVE_INFINITY },
    ]) {
      await assert.rejects(
        writeScenarioReports([makeRow(artifact)], {
          scenarioId: "invalid-json",
          outDir,
          stamp: "bad",
        }),
        /无法序列化|JSON|有限/,
      );
    }
    assert.deepEqual(await readdir(outDir), []);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("report：兼容历史 JSON 语义省略对象字段中的 undefined/function/symbol", async () => {
  const outDir = await mkdtemp(join(os.tmpdir(), "obs-report-omit-"));
  try {
    const artifact: Record<string, unknown> = {
      keep: "ok",
      dropUndefined: undefined,
      dropFunction: () => 1,
      dropSymbol: Symbol("drop"),
    };
    const { jsonPath } = await writeScenarioReports([makeRow(artifact)], {
      scenarioId: "omit",
      outDir,
      stamp: "safe",
    });
    const report = JSON.parse(await readFile(jsonPath, "utf8")) as {
      rows: Array<{ result: { artifact: Record<string, unknown> } }>;
    };
    assert.deepEqual(report.rows[0]!.result.artifact, { keep: "ok" });
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("report：默认以 0600 权限写 md/json", async () => {
  if (process.platform === "win32") return;
  const outDir = await mkdtemp(join(os.tmpdir(), "obs-report-mode-"));
  try {
    const paths = await writeScenarioReports([makeRow()], {
      scenarioId: "mode",
      outDir,
      stamp: "safe",
    });
    for (const path of [paths.mdPath, paths.jsonPath]) {
      const mode = (await stat(path)).mode & 0o777;
      assert.equal(mode, 0o600, path);
    }
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
