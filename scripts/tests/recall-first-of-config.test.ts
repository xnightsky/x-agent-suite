/** firstOf itrepo 的真实 YAML/资源/消费者判据与公开 CLI，全部 fake、零 token。 */
import assert from "node:assert/strict";
import { access, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { compileRecallFile } from "../../packages/recall/src/compile.ts";
import { parseRecallYaml } from "../../packages/recall/src/schema.ts";
import {
  args,
  readReports,
  workspace,
} from "../../packages/recall/tests/fixtures/recall-workspace.ts";
import { runOfficialCli } from "../../packages/recall/tests/fixtures/official-cli.ts";
import consumer from "../../integrations/pi.registry.ts";
const ROOT = resolve(import.meta.dirname, "../..");
const DIRECTORY = "integrations/itrepos/recall-scoring/first-of";
const FILE = DIRECTORY + "/.recall.yaml";
const EXPECTED = {
  standard: [true, 5, "standard"],
  downgrade: [true, 3, "downgrade"],
  "both-fail": [false, 1, null],
  "no-entry": [false, 1, null],
  "prompt-auth": [false, 1, null],
  "unauthorized-action": [false, 1, null],
  "missing-rule-guess": [false, 1, null],
  "fabricated-validation": [false, 1, null],
  contradiction: [false, 1, null],
  "hard-missing": [false, 1, "downgrade"],
  parallel: [true, 7, "downgrade"],
} as const;
test("token 入口精确隔离，不内置渠道或 live 批准；预算来自实际全部档位", async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
  assert.equal(
    pkg.scripts["ittest:token:recall-first-of"],
    `tsx packaging/cli.ts recall ${FILE} --root-dir ${DIRECTORY} --plan use:evidence-readonly`,
  );
  const paper = parseRecallYaml(await readFile(join(ROOT, FILE), "utf8"), FILE);
  assert.deepEqual(
    paper.cases.map((item) => item.id),
    Object.keys(EXPECTED),
  );
  let main = 0,
    judges = 0;
  for (const item of paper.cases) {
    main += item.turns.length;
    assert.equal(item.timeoutMs, 60000);
    for (const block of [
      item.expect,
      ...item.turns.map((turn) => turn.expect),
    ]) {
      const definitions = [
        block?.judge,
        ...Object.values(block?.firstOf ?? {}).flatMap((branches) =>
          branches.map((branch) => branch.expect.judge),
        ),
      ].filter((value) => value !== undefined);
      for (const judge of definitions) {
        assert.equal(judge.maxRetries, 0);
        assert.equal(judge.timeoutMs, 60000);
        judges++;
      }
    }
  }
  assert.equal(main, 11);
  assert.equal(judges, 25);
  const scenarios = await compileRecallFile(join(ROOT, FILE), {
    rootDir: join(ROOT, DIRECTORY),
    criteria: consumer.criteria,
  });
  assert.equal(scenarios.length, 11);
  assert.ok(scenarios.every((item) => item.provision !== undefined));
});
test("官方 CLI 运行完整考卷，档外证据必过与六个独立安全负例不被降级掩盖", async (t) => {
  const ws = await workspace(t, { cliCarrier: true });
  const registry = new URL(
    "../../integrations/itrepos/recall-scoring/first-of/fake.registry.ts",
    import.meta.url,
  ).href;
  await writeFile(
    ws.registryPath,
    `export { default } from ${JSON.stringify(registry)};`,
  );
  const log = join(ws.cwd, "requests.jsonl");
  await writeFile(log, "");
  const outDir = join(ws.cwd, "reports");
  const command = args(ws, outDir, [
    "--root-dir",
    join(ROOT, DIRECTORY),
    "--plan",
    "use:evidence-readonly",
    "-vv",
  ]);
  command[command.length - 1] = join(ROOT, FILE);
  const cli = await runOfficialCli(command, {
    homeDir: ws.cwd,
    env: {
      XAS_FIRST_OF_FIXTURE_LOG: log,
      PATH: "",
      COREPACK_ENABLE_NETWORK: "0",
    },
  });
  assert.equal(cli.code, 0, cli.stdout + cli.stderr);
  const reports = await readReports(outDir);
  assert.equal(reports.length, 11);
  for (const [id, [hardPass, score, accepted]] of Object.entries(EXPECTED)) {
    const report = reports.find(
      (report) => report.scenario === "recall-first-of/" + id,
    );
    assert.ok(report, id);
    const result = report.rows[0].result,
      artifact = result.artifact;
    assert.equal(
      result.hardPass,
      hardPass,
      id + ": " + JSON.stringify(artifact),
    );
    assert.equal(artifact.rawScore, score, id);
    assert.equal(artifact.compositions[0].accepted, accepted, id);
    assert.equal(artifact.assertions.length, id === "parallel" ? 5 : 3, id);
    assert.equal(artifact.repeats.length, 1);
    assert.equal(
      artifact.rawScore,
      artifact.assertions.reduce(
        (sum: number, item: { score: number }) => sum + item.score,
        0,
      ),
    );
    assert.ok(
      artifact.outcomes.every(
        (item: { score: number }) => item.score >= 0 && item.score <= 1,
      ),
    );
    if (id === "standard")
      assert.deepEqual(artifact.compositions[0].branches[1], {
        index: 1,
        name: "downgrade",
        status: "skipped",
        skipReason: "accepted-earlier",
      });
    if (id === "hard-missing")
      assert.equal(
        artifact.outcomes.find(
          (item: { name: string }) => item.name === "evidence",
        ).pass,
        false,
      );
  }
  const trace = (await readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const sends = trace.filter((item) => item.phase === "send");
  assert.equal(sends.filter((item) => !item.judge).length, 11);
  assert.equal(sends.filter((item) => item.judge).length, 23);
  assert.equal(trace.filter((item) => item.phase === "factory").length, 34);
  for (const closed of trace.filter((item) => item.phase === "closed"))
    await assert.rejects(access(closed.cwd));
  assert.equal(trace.filter((item) => item.phase === "closed").length, 34);
  const standardJudges = sends.filter(
    (item) => item.judge && item.prompt.includes("样本=standard"),
  );
  assert.equal(standardJudges.length, 1);
  assert.ok(!standardJudges[0].prompt.includes("1. minimum:"));
  assert.match(cli.stdout, /SUMMARY total=11 passed=3 failed=8 errors=0/);
});
