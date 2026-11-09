/**
 * @module scripts/tests/itrepos-scoring-config
 * 计分场景仓的可执行示例回归：读取真实考卷并复用消费者判据，仅替换模型传输。
 * 不变量：临时 HOME、合成渠道与 fake transport；不启动真实宿主或调用 provider。
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import type { ReportDocument } from "@x-agent-suite/contracts";
import type { RecallAssertionArtifact } from "../../packages/recall/src/assertion-results.ts";
import { compileRecallFile } from "../../packages/recall/src/compile.ts";
import { parseRecallYaml } from "../../packages/recall/src/schema.ts";
import { runOfficialCli } from "../../packages/recall/tests/fixtures/official-cli.ts";
import { readJudgeRequests } from "../../packages/recall/tests/fixtures/recall-judge.registry.ts";
import {
  args,
  readReports,
  workspace,
} from "../../packages/recall/tests/fixtures/recall-workspace.ts";
import consumer from "../../integrations/pi.registry.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const EXAMPLE = "integrations/itrepos/recall-scoring/mechanical/.recall.yaml";
const ROOT_DIR = join(ROOT, "integrations/itrepos/recall-scoring");
const VARIANTS = [
  { id: "omitted", score: undefined, hit: 1, miss: -1 },
  { id: "empty", score: {}, hit: 1, miss: -1 },
  { id: "hit-only", score: { hit: 3 }, hit: 3, miss: -1 },
  { id: "miss-only", score: { miss: 0 }, hit: 1, miss: 0 },
  { id: "both", score: { hit: 2, miss: 0 }, hit: 2, miss: 0 },
  { id: "penalty", score: { hit: 0, miss: -1 }, hit: 0, miss: -1 },
] as const;

async function useConsumerCriteria(path: string) {
  const consumerUrl = new URL(
    "../../integrations/pi.registry.ts",
    import.meta.url,
  ).href;
  const fixtureUrl = new URL(
    "../../packages/recall/tests/fixtures/recall-judge.registry.ts",
    import.meta.url,
  ).href;
  await writeFile(
    path,
    `import consumer from ${JSON.stringify(consumerUrl)};
import fixture from ${JSON.stringify(fixtureUrl)};
export default {
  ...fixture,
  criteria: consumer.criteria,
  transport: async (request) => {
    const response = await fixture.transport(request);
    const body = JSON.parse(response.text);
    body.choices[0].message.content = "TOKEN_SCORE_OK";
    return { ...response, text: JSON.stringify(body) };
  },
};\n`,
  );
}

test("计分 itrepo 的六种机械配置各包含命中和未命中，且不调用 Judge", async () => {
  const path = join(ROOT, EXAMPLE);
  const definition = parseRecallYaml(await readFile(path, "utf8"), path);
  assert.equal(definition.plans, undefined);
  assert.equal(definition.context, undefined);
  assert.equal(definition.cases.length, 12);
  for (const [index, variant] of VARIANTS.entries()) {
    for (const [offset, pass] of [true, false].entries()) {
      const item = definition.cases[index * 2 + offset]!;
      assert.equal(item.id, `${variant.id}-${pass ? "hit" : "miss"}`);
      assert.equal(item.timeoutMs, 60_000);
      assert.deepEqual(item.turns, [
        { send: "只输出 TOKEN_SCORE_OK，不要引号、解释或其他内容。" },
      ]);
      assert.deepEqual(item.expect, {
        "answer-contract": {
          requiredPrefix: pass ? "TOKEN_SCORE_OK" : "TOKEN_SCORE_MISSING",
          ...(variant.score === undefined ? {} : { score: variant.score }),
        },
      });
    }
  }
  const scenarios = await compileRecallFile(path, {
    rootDir: ROOT_DIR,
    criteria: consumer.criteria,
  });
  assert.equal(scenarios.length, 12);
  assert.ok(scenarios.every((item) => item.provision === undefined));
});

function assertReports(
  reports: readonly ReportDocument<RecallAssertionArtifact>[],
  stdout: string,
) {
  assert.equal(reports.length, 12);
  for (const variant of VARIANTS) {
    for (const pass of [true, false]) {
      const id = `recall-scoring-mechanical/${variant.id}-${pass ? "hit" : "miss"}`;
      const result = reports.find((item) => item.rows[0]!.scenario === id)
        ?.rows[0]!.result;
      assert.ok(result, id);
      const contribution = pass ? variant.hit : variant.miss;
      const reason = pass
        ? "最终回答前缀符合约定"
        : "最终回答前缀不符合约定：期望 TOKEN_SCORE_MISSING";
      const detail = { name: "answer-contract", pass, reason };
      assert.equal(result.hardPass, pass);
      assert.equal(result.artifact.rawScore, contribution);
      assert.deepEqual(result.artifact.assertions, [
        { ...detail, source: "mechanical", score: contribution },
      ]);
      assert.deepEqual(result.artifact.outcomes, [
        { ...detail, scope: "session", score: pass ? 1 : 0 },
      ]);
      assert.ok(
        stdout.includes(
          `score=${pass ? 1 : 0} contribution=${contribution} reason=`,
        ),
      );
    }
  }
}

test("机械计分示例经官方 CLI 与真实消费者文本检查得到全部预期报告", async (t) => {
  const ws = await workspace(t);
  const outDir = join(ws.cwd, "reports");
  const logPath = join(ws.cwd, "requests.jsonl");
  await writeFile(logPath, "");
  await useConsumerCriteria(ws.registryPath);
  const executed = await runOfficialCli(
    args({ ...ws, recallPath: join(ROOT, EXAMPLE) }, outDir, [
      "--root-dir",
      ROOT_DIR,
      "-vv",
    ]),
    { homeDir: ws.cwd, env: { XAS_RECALL_TEST_JUDGE_LOG: logPath } },
  );
  assert.equal(executed.code, 0, executed.stderr);
  assertReports(await readReports(outDir), executed.stdout);
  const requests = await readJudgeRequests(logPath);
  assert.equal(requests.length, 12);
  assert.ok(requests.every((item) => !item.judge));
});

test("计分 itrepo 同时提供精确机械入口、集成索引和可复制考卷链接", async () => {
  const config = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
  assert.equal(
    config.scripts["ittest:token:recall-scoring-mechanical"],
    `tsx packaging/cli.ts recall ${EXAMPLE} --root-dir integrations/itrepos/recall-scoring`,
  );
  const index = await readFile(join(ROOT, "integrations/README.md"), "utf8");
  assert.match(index, /\]\(\.\/itrepos\/recall-scoring\/README\.md\)/);
  const readme = await readFile(join(ROOT_DIR, "README.md"), "utf8");
  assert.match(readme, /\]\(\.\/mechanical\/\.recall\.yaml\)/);
  const example = readme.match(/```yaml\n([\s\S]*?)\n```/);
  assert.ok(example);
  const copied = parseRecallYaml(
    [
      "version: 1",
      "id: copied-score",
      "cases:",
      ...example[1]!.split("\n").map((line) => "  " + line),
    ].join("\n"),
    join(ROOT_DIR, "README.md"),
  );
  const source = parseRecallYaml(
    await readFile(join(ROOT, EXAMPLE), "utf8"),
    join(ROOT, EXAMPLE),
  );
  assert.deepEqual(copied.cases, [
    source.cases.find((item) => item.id === "both-hit"),
  ]);
});
