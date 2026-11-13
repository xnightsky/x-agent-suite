/** Recall 公开执行的 repeat/suite 汇总、无断言与 ERROR case 宏平均，零 token。 */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { stringify } from "yaml";
import test from "node:test";
import { createRecallReporter, runRecall } from "../src/index.ts";
import { readReports, workspace } from "./fixtures/recall-workspace.ts";

test("无断言的有效 repeat 保留行为统计，rawScore=null", async (t) => {
  const ws = await workspace(t);
  await writeFile(
    ws.recallPath,
    stringify({
      version: 1,
      id: "empty",
      cases: [{ id: "none", turns: [{ send: "hello" }] }],
    }),
  );
  const result = await runRecall({ ...options(ws), repeat: 2 });
  assert.equal(result.failures.length, 0);
  assert.equal(result.runs[0]!.score.rawScore, null);
  assert.equal(result.runs[0]!.score.passRate, 1);
  assert.equal(result.runs[0]!.score.passAllK, true);
  assert.equal(result.summary.rawScore, null);
  assert.equal(result.summary.passRate, 1);
  const reports = await readReports(ws.cwd + "/reports");
  assert.equal(reports.length, 1);
  const artifact = reports[0]!.rows[0]!.result.artifact;
  assert.equal(artifact.rawScore, undefined);
  assert.equal(artifact.scoreSummary.rawScore, null);
});

test("suite 排除 ERROR case，对有效 target×case 宏平均并由 CLI 同源披露", async (t) => {
  const ws = await workspace(t);
  const base = new URL("./fixtures/recall.registry.ts", import.meta.url).href;
  await writeFile(
    ws.registryPath,
    `import base from ${JSON.stringify(base)};
  export default { ...base, criteria: [...base.criteria, {
    name: "runtime-error", scope: "turn",
    evaluate: () => { throw new Error("scripted invalid"); }
  }] };`,
  );
  await writeFile(
    ws.recallPath,
    stringify({
      version: 1,
      id: "suite",
      cases: [
        {
          id: "pass",
          turns: [{ send: "hello", expect: { "text-contains": ["hello"] } }],
        },
        {
          id: "fail",
          turns: [{ send: "hello", expect: { "text-contains": ["missing"] } }],
        },
        {
          id: "error",
          turns: [{ send: "hello", expect: { "runtime-error": {} } }],
        },
      ],
    }),
  );
  const stdout: string[] = [];
  const result = await runRecall(
    { ...options(ws), repeat: 2 },
    createRecallReporter(0, {
      stdout: (line) => stdout.push(line),
      stderr: () => {},
    }),
  );
  assert.equal(result.runs.length, 2);
  assert.equal(result.failures.length, 1);
  assert.equal(result.summary.planned, 3);
  assert.equal(result.summary.valid, 2);
  assert.equal(result.summary.invalid, 1);
  assert.equal(result.summary.skipped, 0);
  assert.equal(result.summary.coverage, 2 / 3);
  assert.equal(result.summary.invalidRate, 1 / 3);
  assert.equal(result.summary.passRate, 0.5);
  assert.equal(result.summary.rawScore, 0);
  assert.equal(result.summary.passAtK, 0.5);
  assert.equal(result.summary.passAllK, 0.5);
  assert.deepEqual(result.failures[0]!.scoreSummary, {
    planned: 2,
    valid: 0,
    invalid: 1,
    skipped: 1,
    coverage: 0,
    invalidRate: 0.5,
    passRate: null,
    rawScore: null,
    passAtK: null,
    passAllK: false,
  });
  const output = stdout.join("\n");
  assert.match(output, /coverage=0\.6666666666666666/);
  assert.match(output, /passRate=0\.5/);
  assert.match(output, /rawScore=0/);
  assert.match(output, /pass@k=0\.5/);
  assert.match(output, /pass\^k=0\.5/);
});

function options(ws: Awaited<ReturnType<typeof workspace>>) {
  return {
    cwd: ws.cwd,
    homeDir: ws.cwd,
    target: ws.recallPath,
    selection: { carrier: "fixture-carrier" },
    liveConfigPath: ws.livePath,
    registryPath: ws.registryPath,
    outDir: ws.cwd + "/reports",
  };
}
