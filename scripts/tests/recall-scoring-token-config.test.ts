/** Recall 评分 token 考卷的零 token 配置回归：只编译，禁止创建真实执行。 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { compileRecallFile } from "../../packages/recall/src/compile.ts";
import { parseRecallYaml } from "../../packages/recall/src/schema.ts";

const ROOT = new URL("../../", import.meta.url);
const SCENARIO = "integrations/itrepos/recall-scoring/.recall.yaml";

test("评分 token 入口精确指定合成考卷，不内置渠道或 live 批准", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("package.json", ROOT), "utf8"),
  );
  assert.equal(
    packageJson.scripts["ittest:token:recall-scoring"],
    `tsx packaging/cli.ts recall ${SCENARIO} --root-dir integrations/itrepos/recall-scoring`,
  );
});

test("评分 token 考卷固定两 case、五次逻辑调用、零重试且无文件 provision", async () => {
  const path = fileURLToPath(new URL(SCENARIO, ROOT));
  const definition = parseRecallYaml(await readFile(path, "utf8"), path);
  assert.deepEqual(
    definition.cases.map((item) => item.id),
    ["all-pass", "positive-score-fail"],
  );
  let calls = 0;
  for (const item of definition.cases) {
    assert.equal(item.turns.length, 1);
    assert.equal(item.timeoutMs, 60_000);
    assert.equal(item.context, undefined);
    calls += item.turns.length;
    for (const judge of [item.turns[0]!.expect?.judge, item.expect?.judge]) {
      if (!judge) continue;
      assert.equal(judge.maxRetries, 0);
      assert.equal(judge.timeoutMs, 60_000);
      calls += 1;
    }
  }
  assert.equal(definition.context, undefined);
  assert.equal(definition.plans, undefined);
  assert.equal(calls, 5);
  const compiled = await compileRecallFile(path, {
    rootDir: fileURLToPath(
      new URL("integrations/itrepos/recall-scoring", ROOT),
    ),
    criteria: [
      { name: "text-contains", scope: "turn" },
      { name: "answer-contract", scope: "session" },
    ],
  });
  assert.ok(compiled.every((item) => item.provision === undefined));
});

test("评分 token 负例的两个评价点使用同一条明确通过条件", async () => {
  const path = fileURLToPath(new URL(SCENARIO, ROOT));
  const definition = parseRecallYaml(await readFile(path, "utf8"), path);
  const negative = definition.cases[1]!;
  const turnRubric = negative.turns[0]!.expect!.judge!.rubrics.missing!.rubric;
  const finalRubric = negative.expect!.judge!.rubrics.missing!.rubric;
  assert.equal(turnRubric, finalRubric);
  assert.match(finalRubric, /只有包含该标记才能返回 pass=true/);
  assert.match(finalRubric, /没有该标记必须返回 pass=false/);
});
