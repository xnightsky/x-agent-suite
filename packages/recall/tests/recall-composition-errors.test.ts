/** allOf/anyOf 的 ERROR 不发布正常成绩，未执行分支有明确诊断，零 token。 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import { runRecall } from "../src/index.ts";
import { firstOfWorkspace } from "./fixtures/first-of-workspace.ts";
import { readReports } from "./fixtures/recall-workspace.ts";

const registry = new URL(
  "./fixtures/recall-first-of.registry.ts",
  import.meta.url,
).href;
const judged = (name: string, rubric: string) => ({
  name,
  score: { hit: 1, miss: -1 },
  expect: { judge: { maxRetries: 0, rubrics: { [rubric]: { rubric } } } },
});

for (const kind of ["allOf", "anyOf"] as const) {
  test(kind + " 的 ERROR 不吞掉且不构造正常 ScenarioResult", async (t) => {
    const branches =
      kind === "anyOf"
        ? [judged("passed", "pass-a"), judged("broken", "fail-a")]
        : [judged("broken", "fail-a"), judged("unreached", "pass-a")];
    const ws = await firstOfWorkspace(t, { [kind]: { quality: branches } });
    await writeFile(
      ws.registryPath,
      `import base from ${JSON.stringify(registry)};
    export default { ...base, transport: async (request) => {
      const prompt = request.body.messages.at(-1).content;
      if (prompt.startsWith("policy: judge-v1") && prompt.includes("fail-a:"))
        return { status: 500, text: "scripted failure" };
      return base.transport(request);
    } };`,
    );
    process.env.XAS_RECALL_TEST_JUDGE_LOG = ws.log;
    t.after(() => delete process.env.XAS_RECALL_TEST_JUDGE_LOG);
    const result = await runRecall({ ...ws.options, repeat: 2 });
    assert.equal(result.runs.length, 0);
    assert.equal(result.failures.length, 1);
    assert.equal(result.summary.valid, 0);
    assert.equal(result.summary.invalid, 1);
    assert.equal(result.summary.rawScore, null);
    const failure = result.failures[0]!;
    assert.deepEqual(failure.scoreSummary, {
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
    const diagnostic = JSON.parse(
      await readFile(failure.reports!.jsonPath, "utf8"),
    );
    assert.equal("rawScore" in diagnostic, false);
    assert.equal("hardPass" in diagnostic, false);
    assert.equal("rows" in diagnostic, false);
    assert.deepEqual(diagnostic.repeatSummary, failure.scoreSummary);
    const composition = diagnostic.compositions[0];
    assert.equal(composition.kind, kind);
    assert.equal(composition.status, "error");
    assert.equal(composition.commonMiss, kind === "allOf" ? undefined : -1);
    if (kind === "anyOf") {
      assert.equal(composition.branches[0].result.pass, true);
      assert.equal(composition.branches[1].status, "error");
    } else {
      assert.equal(composition.branches[0].status, "error");
      assert.equal(composition.branches[1].status, "skipped");
      assert.equal(composition.branches[1].skipReason, "error");
    }
    assert.deepEqual(await readReports(ws.outDir), []);
  });
}
