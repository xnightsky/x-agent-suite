/**
 * @module @x-agent-suite/observation/tests/observation-report
 * ScenarioResult 列表 → md/json 报告生成的单元测试。
 * 不变量：报告同时产出 .md（结论表）与 .json（完整明细）。
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { inspect } from "node:util";
import { writeScenarioReports, type ScenarioReportRow } from "../src/report.ts";

/** 构造一行最小报告行。 */
function makeRow(
  overrides: Partial<ScenarioReportRow> = {},
): ScenarioReportRow {
  return {
    scenario: "send-message",
    carrier: "fixture-carrier",
    promptVariant: "concise",
    result: {
      observation: {
        text: "已发送消息。",
        toolCalls: [
          {
            name: "message",
            input: { handle: "A", action: "send", to: "B", message: "hello" },
            status: "completed",
          },
        ],
        toolCallsCount: 1,
        events: [{ type: "prompt", timestamp: 1 }],
      },
      artifact: { inboxB: [], roster: [], aIsPresent: true },
      dryPass: true,
      hardPass: true,
      fuzzyPass: true,
      latencyMs: 12,
    },
    ...overrides,
  };
}

test("writeScenarioReports：同 stamp 同时产出 md 结论表与 json 明细", async () => {
  const outDir = await mkdtemp(join(os.tmpdir(), "obs-report-"));
  try {
    const { mdPath, jsonPath } = await writeScenarioReports([makeRow()], {
      scenarioId: "send-message",
      outDir,
      stamp: "2026-08-23T00-00-00",
    });
    assert.ok(
      mdPath.endsWith("2026-08-23T00-00-00-send-message-report.md"),
      `md 文件名: ${mdPath}`,
    );
    assert.ok(
      jsonPath.endsWith("2026-08-23T00-00-00-send-message-report.json"),
      `json 文件名: ${jsonPath}`,
    );

    const md = await readFile(mdPath, "utf8");
    assert.ok(md.includes("fixture-carrier"), "md 应含 carrier 列");
    assert.ok(md.includes("concise"), "md 应含 prompt 变体列");
    assert.ok(md.includes("send-message"), "md 应含 scenario 标识");

    const json = JSON.parse(await readFile(jsonPath, "utf8")) as {
      rows: ScenarioReportRow[];
    };
    assert.equal(json.rows.length, 1);
    assert.equal(json.rows[0]?.result.hardPass, true);
    assert.equal(
      json.rows[0]?.result.observation.toolCalls[0]?.name,
      "message",
    );
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("writeScenarioReports：失败行在 md 中体现 pass 标记差异", async () => {
  const outDir = await mkdtemp(join(os.tmpdir(), "obs-report-"));
  try {
    const base = makeRow();
    const failRow: ScenarioReportRow = {
      ...makeRow({ carrier: "fixture-host" }),
      result: {
        ...base.result,
        hardPass: false,
        error: "no-tool-call: 未调用 message(action=send)",
      },
    };
    const { mdPath, jsonPath } = await writeScenarioReports([base, failRow], {
      scenarioId: "send-message",
      outDir,
      stamp: "s1",
    });
    const md = await readFile(mdPath, "utf8");
    assert.ok(md.includes("fixture-host"), "md 应含失败行 carrier");
    assert.ok(md.includes("no-tool-call"), "md 应含失败原因");
    const json = JSON.parse(await readFile(jsonPath, "utf8")) as {
      rows: ScenarioReportRow[];
    };
    assert.equal(json.rows[1]?.result.hardPass, false);
    assert.equal(
      json.rows[1]?.result.error,
      "no-tool-call: 未调用 message(action=send)",
    );
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("writeScenarioReports：写盘前递归脱敏且不修改调用方数据", async () => {
  const outDir = await mkdtemp(join(os.tmpdir(), "obs-report-redact-"));
  const secret = "synthetic-report-secret";
  const base = makeRow();
  const row: ScenarioReportRow = {
    ...base,
    carrier: `carrier-${secret}`,
    stdoutTail: `stdout=${secret}`,
    stderrTail: `stderr=${secret}`,
    result: {
      ...base.result,
      observation: {
        ...base.result.observation,
        text: `text=${secret}`,
        events: [{ type: "secret", timestamp: 1, payload: { secret } }],
      },
      artifact: { [secret]: { secret } },
      error: `error=${secret}`,
    },
  };
  try {
    const paths = await writeScenarioReports([row], {
      scenarioId: "redaction",
      outDir,
      stamp: "safe",
      redact: (text) => text.replaceAll(secret, "[REDACTED]"),
    });
    const output = `${await readFile(paths.mdPath, "utf8")}\n${await readFile(paths.jsonPath, "utf8")}`;
    assert.doesNotMatch(output, new RegExp(secret));
    assert.match(output, /\[REDACTED\]/);
    assert.match(row.result.error!, new RegExp(secret));
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("writeScenarioReports：脱敏键碰撞时保留全部报告字段", async () => {
  const outDir = await mkdtemp(join(os.tmpdir(), "obs-report-collision-"));
  const secret = "synthetic-key-secret";
  const base = makeRow();
  const row: ScenarioReportRow = {
    ...base,
    result: {
      ...base.result,
      artifact: {
        [secret]: "secret-key-value",
        "[REDACTED]": "existing-redacted-key",
      },
    },
  };
  try {
    const { jsonPath } = await writeScenarioReports([row], {
      scenarioId: "collision",
      outDir,
      stamp: "safe",
      redact: (text) => text.replaceAll(secret, "[REDACTED]"),
    });
    const report = JSON.parse(await readFile(jsonPath, "utf8")) as {
      rows: Array<{ result: { artifact: Record<string, string> } }>;
    };
    const artifact = report.rows[0]?.result.artifact ?? {};
    assert.equal(Object.keys(artifact).length, 2);
    assert.deepEqual(
      new Set(Object.values(artifact)),
      new Set(["secret-key-value", "existing-redacted-key"]),
    );
    assert.doesNotMatch(Object.keys(artifact).join("\n"), new RegExp(secret));
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("writeScenarioReports：循环报告数据异常经 redact 后再暴露", async () => {
  const outDir = await mkdtemp(join(os.tmpdir(), "obs-report-cycle-"));
  const secret = "synthetic-cycle-secret";
  const cyclic: Record<string, unknown> = {};
  cyclic[secret] = cyclic;
  const base = makeRow();
  const row: ScenarioReportRow = {
    ...base,
    result: { ...base.result, artifact: cyclic },
  };
  try {
    await assert.rejects(
      writeScenarioReports([row], {
        scenarioId: "cycle",
        outDir,
        stamp: "safe",
        redact: (text) => text.replaceAll(secret, "[REDACTED]"),
      }),
      (error: unknown) => {
        const diagnostic = inspect(error, { depth: 10 });
        assert.doesNotMatch(diagnostic, new RegExp(secret));
        assert.match(diagnostic, /无法序列化|循环引用/);
        return true;
      },
    );
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("writeScenarioReports：拒绝可逃逸或跨平台非法的 stamp 路径段", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "obs-report-path-"));
  const outDir = join(root, "reports");
  const invalid = [
    "..",
    ".",
    "../outside",
    "..\\outside",
    "/absolute",
    "C:\\absolute",
    "bad\0stamp",
  ];
  try {
    for (const stamp of invalid) {
      await assert.rejects(
        writeScenarioReports([makeRow()], {
          scenarioId: "safe-scenario",
          outDir,
          stamp,
        }),
        /stamp.*安全路径段/,
      );
    }
    assert.equal(
      await readFile(
        join(root, "outside-safe-scenario-report.json"),
        "utf8",
      ).catch(() => null),
      null,
      "不得在 outDir 外写报告",
    );
    await assert.rejects(
      writeScenarioReports([makeRow()], {
        scenarioId: "safe-scenario",
        outDir,
        stamp: "safe",
        redact: () => "../redacted-escape",
      }),
      /stamp.*安全路径段/,
    );
    const safe = await writeScenarioReports([makeRow()], {
      scenarioId: "safe-scenario",
      outDir,
      stamp: "..safe",
    });
    assert.equal(dirname(safe.jsonPath), outDir);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writeScenarioReports：scenarioId 编码为单个安全文件名段", async () => {
  const outDir = await mkdtemp(join(os.tmpdir(), "obs-report-"));
  try {
    const scenarioId = "domain/../../outside";
    const { mdPath, jsonPath } = await writeScenarioReports([makeRow()], {
      scenarioId,
      outDir,
      stamp: "safe",
    });
    assert.equal(dirname(mdPath), outDir);
    assert.equal(dirname(jsonPath), outDir);
    assert.equal(
      basename(mdPath),
      `safe-${encodeURIComponent(scenarioId)}-report.md`,
    );
    const json = JSON.parse(await readFile(jsonPath, "utf8")) as {
      scenario: string;
    };
    assert.equal(json.scenario, scenarioId, "报告内容仍保留原始 scenarioId");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
