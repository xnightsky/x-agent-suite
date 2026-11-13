/** 组合内机械 resolver 的 opt-in、缓存、共同 miss 与 repeat/suite 汇总，零 token。 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runRecall } from "../src/index.ts";
import { firstOfWorkspace } from "./fixtures/first-of-workspace.ts";
import {
  readJudgeRequests,
  readJudgeRequests as readRequests,
} from "./fixtures/recall-judge.registry.ts";
import { readReports } from "./fixtures/recall-workspace.ts";

const REGISTRY = new URL(
  "./fixtures/recall-scoring.registry.ts",
  import.meta.url,
).href;

async function scoringWorkspace(
  t: Parameters<typeof firstOfWorkspace>[0],
  expect: object,
) {
  const ws = await firstOfWorkspace(t, expect);
  await writeFile(
    ws.registryPath,
    "export { default } from " + JSON.stringify(REGISTRY),
  );
  const scoreLog = join(ws.cwd, "scores.jsonl");
  await writeFile(scoreLog, "");
  process.env.XAS_RECALL_TEST_SCORE_LOG = scoreLog;
  process.env.XAS_RECALL_TEST_JUDGE_LOG = ws.log;
  t.after(() => {
    delete process.env.XAS_RECALL_TEST_SCORE_LOG;
    delete process.env.XAS_RECALL_TEST_JUDGE_LOG;
  });
  return { ...ws, scoreLog };
}

test("机械叶子 opt-in 只预检一次，repeat 独立且 suite 宏平均可读取", async (t) => {
  const ws = await scoringWorkspace(t, {
    anyOf: {
      quality: [
        {
          name: "hit",
          expect: {
            "scored-text": { text: "最终答案", score: { hit: 2, miss: -2 } },
          },
        },
        {
          name: "miss",
          expect: {
            "scored-text": { text: "不存在", score: { hit: 5, miss: -2 } },
          },
        },
      ],
    },
  });
  const result = await runRecall({ ...ws.options, repeat: 2 });
  assert.equal(result.failures.length, 0);
  assert.equal(result.runs.length, 1);
  assert.deepEqual(result.runs[0]!.score, {
    planned: 2,
    valid: 2,
    invalid: 0,
    skipped: 0,
    coverage: 1,
    invalidRate: 0,
    passRate: 1,
    rawScore: { mean: 2, min: 2, max: 2 },
    passAtK: true,
    passAllK: true,
  });
  assert.deepEqual(result.summary, {
    planned: 1,
    valid: 1,
    invalid: 0,
    skipped: 0,
    coverage: 1,
    invalidRate: 0,
    passRate: 1,
    rawScore: 2,
    passAtK: 1,
    passAllK: 1,
  });
  const reports = await readReports(ws.outDir);
  const artifact = reports[0]!.rows[0]!.result.artifact;
  assert.equal(artifact.rawScore, 2);
  assert.equal(artifact.compositions[0]!.accepted, "hit");
  assert.deepEqual(
    artifact.compositions[0]!.branches.map(
      (branch: { contribution: number }) => branch.contribution,
    ),
    [2, -2],
  );
  assert.deepEqual(artifact.scoreSummary, result.runs[0]!.score);
  assert.deepEqual(
    artifact.repeats.map((repeat: { rawScore: number }) => repeat.rawScore),
    [2, 2],
  );
  const scores = (await readFile(ws.scoreLog, "utf8")).trim().split("\n");
  assert.equal(scores.length, 2);
  const requests = await readRequests(ws.log);
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => !request.judge));
});

test("机械 resolver 决定共同 miss，定义错误时零主执行", async (t) => {
  const ws = await scoringWorkspace(t, {
    firstOf: {
      quality: [
        {
          name: "a",
          expect: {
            "scored-text": { text: "最终答案", score: { hit: 1, miss: -1 } },
          },
        },
        {
          name: "b",
          expect: {
            "scored-text": { text: "最终答案", score: { hit: 1, miss: -2 } },
          },
        },
      ],
    },
  });
  await assert.rejects(runRecall(ws.options), /miss/);
  assert.equal((await readJudgeRequests(ws.log)).length, 0);
  assert.equal(
    (await readFile(ws.scoreLog, "utf8")).trim().split("\n").length,
    2,
  );
});
