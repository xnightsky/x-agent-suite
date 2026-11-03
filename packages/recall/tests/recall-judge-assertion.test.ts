/**
 * @module @x-agent-suite/recall/tests/recall-judge-assertion
 * 一期 case 级机械/AI 断言直接计分的统一 CLI 纵向验收。
 */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runOfficialCli } from "./fixtures/official-cli.ts";
import { args, readReports, workspace } from "./fixtures/recall-workspace.ts";
import { readJudgeRequests } from "./fixtures/recall-judge.registry.ts";

const REGISTRY_URL = new URL(
  "./fixtures/recall-judge.registry.ts",
  import.meta.url,
).href;

test("两轮四细项直接计分：总分 3 但 case 未通过，CLI=0", async (t) => {
  const ws = await workspace(t);
  await writeFile(
    ws.registryPath,
    "export { default } from " + JSON.stringify(REGISTRY_URL) + ";\n",
  );
  const yaml = [
    "version: 1",
    "id: assertion-scoring",
    "cases:",
    "  - id: four-items",
    "    turns:",
    "      - send: 准备回答",
    "      - send: 给出结论",
    "    expect:",
    "      mechanical-a: {}",
    "      mechanical-b: {}",
    "      judge:",
    "        ai-a:",
    "          rubric: 判断是否满足甲标准",
    "          score: { hit: 3 }",
    "        ai-b:",
    "          rubric: 判断是否满足乙标准",
    "          score: { miss: 0 }",
    "",
  ].join("\n");
  await writeFile(ws.recallPath, yaml);
  const outDir = join(ws.cwd, "reports");
  const requestLog = join(ws.cwd, "judge-requests.jsonl");
  await writeFile(requestLog, "");
  const executed = await runOfficialCli(args(ws, outDir), {
    homeDir: ws.cwd,
    env: { XAS_RECALL_TEST_JUDGE_LOG: requestLog },
  });
  assert.equal(executed.code, 0, executed.stderr);
  assert.match(executed.stdout, /FAIL assertion-scoring\/four-items/);

  const requests = await readJudgeRequests(requestLog);
  assert.equal(requests.filter((request) => request.judge).length, 1);
  const judgeRequest = requests.find((request) => request.judge)!;
  assert.equal(judgeRequest.messageCount, 1, "Judge 使用独立单轮会话");
  assert.match(judgeRequest.prompt, /最终答案/);
  assert.doesNotMatch(judgeRequest.prompt, /中间答案/);
  assert.doesNotMatch(judgeRequest.prompt, /hit:\s*3|miss:\s*0|score:\s*\{/);
  assert.match(judgeRequest.prompt, /判断是否满足甲标准/);
  assert.match(judgeRequest.prompt, /判断是否满足乙标准/);

  const [report] = await readReports(outDir);
  const result = report.rows[0].result;
  assert.equal(result.hardPass, false);
  assert.equal(result.artifact.rawScore, 3);
  assert.deepEqual(
    result.artifact.outcomes.map((outcome: { score: number }) => outcome.score),
    [1, 0, 1, 0],
    "底层 CriterionOutcome 保持 0/1 标准分",
  );
  const details = result.artifact.assertions.map(
    (outcome: Record<string, unknown>) => ({
      name: outcome.name,
      source: outcome.source,
      pass: outcome.pass,
      reason: outcome.reason,
      score: outcome.score,
    }),
  );
  assert.deepEqual(details, [
    {
      name: "mechanical-a",
      source: "mechanical",
      pass: true,
      reason: "mechanical-a 通过",
      score: 1,
    },
    {
      name: "mechanical-b",
      source: "mechanical",
      pass: false,
      reason: "mechanical-b 未通过",
      score: -1,
    },
    {
      name: "judge.ai-a",
      source: "ai",
      pass: true,
      reason: "AI A 通过",
      score: 3,
    },
    {
      name: "judge.ai-b",
      source: "ai",
      pass: false,
      reason: "AI B 未通过",
      score: 0,
    },
  ]);
  assert.equal(
    new Set(details.map((item: { name: string }) => item.name)).size,
    4,
  );
});
