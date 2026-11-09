/** firstOf 错误/预检/API 记录：全部 fake，零 token。 */
import assert from "node:assert/strict";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runRecall, type RecallRunEvent } from "../src/index.ts";
import {
  firstOfBranches as branches,
  firstOfWorkspace,
} from "./fixtures/first-of-workspace.ts";
import { readJudgeRequests } from "./fixtures/recall-judge.registry.ts";
import { readReports } from "./fixtures/recall-workspace.ts";
for (const mode of ["parse", "absent", "call", "timeout"])
  test(`组合 ${mode} 不降级且落 ERROR 诊断`, async (t) => {
    const tiers = branches("fail-a", "pass-b");
    Object.assign(tiers[0]!.expect.judge, {
      timeoutMs: mode === "timeout" ? 5 : 1000,
    });
    const ws = await firstOfWorkspace(t, { firstOf: { quality: tiers } });
    process.env.XAS_RECALL_TEST_JUDGE_LOG = ws.log;
    process.env.XAS_RECALL_TEST_JUDGE_MODE = mode;
    t.after(() => {
      delete process.env.XAS_RECALL_TEST_JUDGE_LOG;
      delete process.env.XAS_RECALL_TEST_JUDGE_MODE;
    });
    const events: RecallRunEvent[] = [];
    const result = await runRecall({ ...ws.options, repeat: 2 }, (event) =>
      events.push(event),
    );
    assert.equal(result.runs.length, 0);
    assert.equal(result.failures.length, 1);
    const failure = result.failures[0]!;
    assert.ok(failure.reports);
    const diagnostic = JSON.parse(
      await readFile(failure.reports.jsonPath, "utf8"),
    );
    assert.equal(diagnostic.status, "error");
    assert.equal(diagnostic.repeatIndex, 0);
    assert.equal(diagnostic.compositions[0].status, "error");
    assert.equal(diagnostic.compositions[0].branches[1].status, "skipped");
    assert.equal(diagnostic.compositions[0].branches[1].skipReason, "error");
    assert.equal("rawScore" in diagnostic, false);
    assert.equal("hardPass" in diagnostic, false);
    assert.equal("rows" in diagnostic, false);
    assert.equal(diagnostic.completedRepeats.length, 0);
    assert.equal(diagnostic.pendingRepeats.length, 1);
    assert.equal(
      diagnostic.compositions[0].branches[0].judge.status,
      mode === "absent" ? "completed" : "not-evaluated",
    );
    assert.equal(diagnostic.cleanup[0].status, "closed");
    const requests = await readJudgeRequests(ws.log);
    assert.ok(!requests.some((item) => item.prompt.includes("pass-b:")));
    assert.equal(
      events.filter(
        (event) =>
          event.type === "composition" &&
          event.event.phase === "composition-error",
      ).length,
      1,
    );
    assert.deepEqual(await readReports(ws.outDir), []);
    if (process.platform !== "win32")
      assert.equal((await stat(failure.reports.jsonPath)).mode & 0o777, 0o600);
  });
test("无 listener 仍持久化 repeat 与同名 rubric 独立批次", async (t) => {
  const tiers = branches("shared", "shared");
  tiers[0]!.expect.judge.rubrics.shared!.rubric = "FAIL strict";
  const ws = await firstOfWorkspace(t, { firstOf: { quality: tiers } });
  const result = await runRecall({ ...ws.options, repeat: 2 });
  assert.equal(result.failures.length, 0);
  const reports = await readReports(ws.outDir);
  const artifact = reports[0].rows[0].result.artifact;
  assert.equal(artifact.repeats.length, 2);
  assert.deepEqual(
    artifact.repeats.map((item: { rawScore: number }) => item.rawScore),
    [1, 1],
  );
  assert.equal(artifact.outcomes[0].score, 1);
  assert.equal("__recallComposition" in artifact.outcomes[0], false);
  const md = await readFile(result.runs[0]!.reports.mdPath, "utf8");
  assert.match(md, /contribution=1/);
  assert.match(md, /rawScore=0/);
  assert.match(md, /skipped|downgrade/);
});
test("未执行低档的引用、scope、工厂和 score 也须主执行前拒绝", async (t) => {
  for (const kind of ["missing", "scope", "factory", "score", "reserved"]) {
    const tiers = branches("pass-a", "pass-b");
    const ws = await firstOfWorkspace(t, { firstOf: { quality: tiers } });
    const extra =
      kind === "reserved"
        ? "{ name:'firstOf', scope:'session', evaluate:()=>({pass:true,score:1,reason:'x'}) }"
        : kind === "factory"
          ? "{ name:'bad',scope:'session',create:()=>{throw new Error('factory secret')} }"
          : kind === "score"
            ? "{ name:'bad',scope:'session',evaluate:()=>({pass:true,score:1,reason:'x'}),assertionScore:()=>({hit:NaN}) }"
            : "";
    const metric = kind === "scope" ? "text-contains" : "bad";
    await writeFile(
      ws.registryPath,
      `import base from ${JSON.stringify(ws.registry)}; export default { ...base, criteria: [...base.criteria, ${extra}] };`,
    );
    if (kind !== "reserved") {
      const { parse, stringify } = await import("yaml");
      const paper = parse(await readFile(ws.recallPath, "utf8"));
      paper.cases[0].expect.firstOf.quality[1].expect = { [metric]: {} };
      await writeFile(ws.recallPath, stringify(paper));
    }
    process.env.XAS_RECALL_TEST_JUDGE_LOG = ws.log;
    try {
      await assert.rejects(runRecall(ws.options));
      assert.equal((await readJudgeRequests(ws.log)).length, 0);
    } finally {
      delete process.env.XAS_RECALL_TEST_JUDGE_LOG;
    }
  }
});
