/** 组合计分 itrepo 的真实 YAML、公开 CLI、报告、预算与清理，全部 fake、零 token。 */
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
import type { RecallComposition } from "../../packages/recall/src/index.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const DIRECTORY = "integrations/itrepos/recall-scoring/composition";
const FILE = DIRECTORY + "/.recall.yaml";
const EXPECTED = {
  "combined-pass": { hardPass: true, rawScore: 12 },
  "expected-fail": { hardPass: false, rawScore: 4 },
} as const;

test("组合 token 入口精确隔离，考卷固定两 case、每轮八次 Judge、零重试", async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
  assert.equal(
    pkg.scripts["ittest:token:recall-composition-scoring"],
    `tsx packaging/cli.ts recall ${FILE} --root-dir ${DIRECTORY}`,
  );
  const path = join(ROOT, FILE);
  const paper = parseRecallYaml(await readFile(path, "utf8"), FILE);
  assert.deepEqual(
    paper.cases.map((item) => item.id),
    Object.keys(EXPECTED),
  );
  let judges = 0;
  for (const item of paper.cases) {
    assert.equal(item.timeoutMs, 60000);
    assert.equal(item.turns.length, 1);
    const block = item.turns[0]!.expect!;
    assert.equal(Object.keys(block.allOf ?? {}).length, 1);
    assert.equal(Object.keys(block.anyOf ?? {}).length, 1);
    assert.equal(Object.keys(block.firstOf ?? {}).length, 2);
    const definitions = [
      ...Object.values(block.allOf ?? {}),
      ...Object.values(block.anyOf ?? {}),
      ...Object.values(block.firstOf ?? {}),
    ].flatMap((branches) => branches.map((branch) => branch.expect.judge));
    const judgeDefinitions = definitions.filter((value) => value !== undefined);
    assert.equal(judgeDefinitions.length, 8);
    for (const judge of judgeDefinitions) {
      assert.equal(judge.maxRetries, 0);
      assert.equal(judge.timeoutMs, 60000);
      judges++;
    }
  }
  assert.equal(judges, 16);
  const scenarios = await compileRecallFile(path, {
    rootDir: join(ROOT, DIRECTORY),
    criteria: [{ name: "text-contains", scope: "turn" }],
  });
  assert.equal(scenarios.length, 2);
  assert.ok(scenarios.every((item) => item.provision === undefined));
});

test("官方 CLI repeat=2 核对组合贡献、rawScore、宏平均和全部 sandbox 清理", async (t) => {
  const ws = await workspace(t, { cliCarrier: true });
  const registry = new URL(
    "../../integrations/itrepos/recall-scoring/composition/fake.registry.ts",
    import.meta.url,
  ).href;
  await writeFile(
    ws.registryPath,
    "export { default } from " + JSON.stringify(registry),
  );
  const log = join(ws.cwd, "requests.jsonl");
  await writeFile(log, "");
  const outDir = join(ws.cwd, "reports");
  const command = args(ws, outDir, [
    "--root-dir",
    join(ROOT, DIRECTORY),
    "--repeat",
    "2",
    "-vv",
  ]);
  command[command.length - 1] = join(ROOT, FILE);
  const cli = await runOfficialCli(command, {
    homeDir: ws.cwd,
    env: { XAS_COMPOSITION_FIXTURE_LOG: log },
  });
  assert.equal(cli.code, 0, cli.stdout + cli.stderr);
  const reports = await readReports(outDir);
  assert.equal(reports.length, 2);
  for (const [id, expected] of Object.entries(EXPECTED)) {
    const report = reports.find(
      (item) => item.scenario === "recall-composition/" + id,
    );
    assert.ok(report, id);
    const result = report.rows[0]!.result;
    const artifact = result.artifact;
    assert.equal(result.hardPass, expected.hardPass, id);
    assert.equal(artifact.rawScore, expected.rawScore, id);
    assert.equal(artifact.assertions.length, 5, id);
    assert.equal(artifact.compositions.length, 4, id);
    assert.equal(artifact.repeats.length, 2, id);
    assert.deepEqual(
      artifact.repeats.map((repeat: { rawScore: number }) => repeat.rawScore),
      [expected.rawScore, expected.rawScore],
      id,
    );
    assert.deepEqual(
      artifact.scoreSummary.rawScore,
      {
        mean: expected.rawScore,
        min: expected.rawScore,
        max: expected.rawScore,
      },
      id,
    );
    assert.equal(artifact.scoreSummary.passRate, expected.hardPass ? 1 : 0, id);
    assert.equal(artifact.scoreSummary.passAllK, expected.hardPass, id);
    assert.equal(
      artifact.rawScore,
      artifact.assertions.reduce(
        (sum: number, item: { score: number }) => sum + item.score,
        0,
      ),
      id,
    );
    const byKind = new Map<string, RecallComposition>(
      artifact.compositions.map((item: RecallComposition) => [
        item.kind + ":" + item.assertionName.split(".").at(-1),
        item,
      ]),
    );
    const all = byKind.get("allOf:required");
    const any = byKind.get("anyOf:acceptable");
    const zero = byKind.get("firstOf:zero");
    const leaves = byKind.get("firstOf:leaves");
    assert.ok(all && any && zero && leaves);
    assert.equal(all.status, expected.hardPass ? "passed" : "failed", id);
    assert.equal(any.accepted, expected.hardPass ? "detailed" : null, id);
    assert.equal(any.commonMiss, -2, id);
    assert.equal(zero.accepted, "downgrade", id);
    assert.equal(
      zero.branches[0]!.contribution,
      id === "combined-pass" ? 0 : -1,
      id,
    );
    assert.equal(leaves.accepted, "downgrade", id);
    assert.equal(leaves.branches[0]!.scoreSource, "leaves", id);
    assert.equal(
      leaves.branches[0]!.contribution,
      id === "combined-pass" ? 0 : -2,
      id,
    );
    if (id === "expected-fail") {
      assert.equal(all.branches[1]!.result?.pass, false);
      assert.equal(all.branches[1]!.contribution, 0);
      assert.equal(
        artifact.assertions.find((item: { name: string }) =>
          item.name.endsWith("anyOf.acceptable"),
        ).score,
        -2,
      );
    }
    assert.ok(
      artifact.compositions.every(
        (composition: { branches: { cleanup?: unknown[] }[] }) =>
          composition.branches.every(
            (branch) => (branch.cleanup?.length ?? 0) === 1,
          ),
      ),
      id,
    );
  }
  const trace = (await readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const sends = trace.filter((item) => item.phase === "send");
  assert.equal(sends.filter((item) => !item.judge).length, 4);
  assert.equal(sends.filter((item) => item.judge).length, 32);
  assert.equal(trace.filter((item) => item.phase === "factory").length, 36);
  const closed = trace.filter((item) => item.phase === "closed");
  assert.equal(closed.length, 36);
  for (const item of closed) await assert.rejects(access(item.cwd));
  assert.match(cli.stdout, /SUMMARY total=2 passed=1 failed=1 errors=0/);
  assert.match(cli.stdout, /coverage=1/);
  assert.match(cli.stdout, /passRate=0.5/);
  assert.match(cli.stdout, /rawScore=8/);
  assert.match(cli.stdout, /pass@k=0.5/);
  assert.match(cli.stdout, /pass\^k=0.5/);
});
