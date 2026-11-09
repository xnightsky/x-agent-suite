/** firstOf 的落盘 YAML 与官方 CLI 公开接线，零 token。 */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { args, readReports } from "./fixtures/recall-workspace.ts";
import { runOfficialCli } from "./fixtures/official-cli.ts";
import { readJudgeRequests } from "./fixtures/recall-judge.registry.ts";
import {
  firstOfBranches as branches,
  firstOfWorkspace,
} from "./fixtures/first-of-workspace.ts";
async function execute(
  t: TestContext,
  expect: object,
  extra: readonly string[] = [],
  turns: object[] = [{ send: "same answer" }],
) {
  const ws = await firstOfWorkspace(t, expect, turns);
  const { log, outDir } = ws;
  const cli = await runOfficialCli(args(ws, outDir, extra), {
    homeDir: ws.cwd,
    env: { XAS_RECALL_TEST_JUDGE_LOG: log },
  });
  assert.equal(cli.code, 0, cli.stdout + cli.stderr);
  const reports = await readReports(outDir);
  const report = reports[0];
  assert.ok(report, cli.stdout + cli.stderr);
  const md = (await readdir(outDir, { recursive: true })).find((path) =>
    path.endsWith("-report.md"),
  );
  assert.ok(md);
  const markdown = await readFile(join(outDir, md), "utf8");
  return {
    artifact: report.rows[0].result.artifact,
    result: report.rows[0].result,
    requests: await readJudgeRequests(log),
    cli,
    markdown,
    outDir,
  };
}
for (const [a, b, accepted, score] of [
  ["pass-a", "pass-b", "standard", 3],
  ["fail-a", "pass-b", "downgrade", 1],
  ["fail-a", "fail-b", null, -1],
] as const) {
  test(`公开 CLI ${a}/${b}`, async (t) => {
    const run = await execute(t, { firstOf: { quality: branches(a, b) } }, [
      "-vv",
    ]);
    assert.equal(run.result.hardPass, accepted !== null);
    assert.equal(run.artifact.rawScore, score);
    assert.equal(run.artifact.assertions.length, 1);
    assert.equal(run.artifact.assertions[0].source, "composite");
    assert.equal(run.artifact.compositions[0].accepted, accepted);
    assert.equal(run.requests.filter((item) => !item.judge).length, 1);
    assert.equal(
      run.requests.filter((item) => item.judge).length,
      accepted === "standard" ? 1 : 2,
    );
    assert.equal(run.artifact.outcomes[0].score, accepted ? 1 : 0);
    assert.match(run.cli.stdout, /firstOf.quality/);
    if (accepted === "standard")
      assert.equal(run.artifact.compositions[0].branches[1].status, "skipped");
    else
      assert.equal(
        run.artifact.compositions[0].branches[0].conditions[0].pass,
        false,
      );
  });
}
test("外层硬约束和平铺 Judge 与并列组合仍为 AND", async (t) => {
  const run = await execute(t, {
    "mechanical-b": {},
    judge: { "pass-honesty": { rubric: "honesty" } },
    firstOf: {
      a: branches("fail-a", "pass-b"),
      b: branches("pass-c", "pass-d"),
    },
  });
  assert.equal(run.result.hardPass, false);
  assert.equal(run.artifact.rawScore, 4);
  assert.equal(run.artifact.assertions.length, 4);
  assert.equal(run.artifact.compositions.length, 2);
  assert.equal(run.requests.filter((item) => item.judge).length, 4);
});
test("逐轮择档完成后才发送下一轮，repeat 不串缓存", async (t) => {
  const run = await execute(
    t,
    {},
    ["--repeat", "2"],
    [
      {
        send: "first",
        expect: { firstOf: { quality: branches("fail-a", "pass-b") } },
      },
      { send: "second" },
    ],
  );
  assert.deepEqual(
    run.requests.map((item) => item.judge),
    [false, true, true, false, false, true, true, false],
  );
  assert.equal(run.artifact.repeats.length, 2);
  assert.deepEqual(
    run.artifact.repeats.map((item: { rawScore: number }) => item.rawScore),
    [1, 1],
  );
  assert.equal(
    run.artifact.compositions[0].assertionName,
    "turn.0.firstOf.quality",
  );
});
