/**
 * @module @x-agent-suite/recall/tests/recall-mechanical-scoring
 * 六种机械配置经官方 CLI 贯通 turn/case、repeat、预检缓存与报告；全部使用零网络夹具。
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import type { AssertionScoreConfig } from "@x-agent-suite/assertions";
import type { ReportDocument, ScenarioResult } from "@x-agent-suite/contracts";
import type { RecallAssertionArtifact } from "../src/assertion-results.ts";
import { stringify } from "yaml";
import { runOfficialCli } from "./fixtures/official-cli.ts";
import { args, readReports, workspace } from "./fixtures/recall-workspace.ts";
import { readJudgeRequests } from "./fixtures/recall-judge.registry.ts";

const REGISTRY_URL = new URL(
  "./fixtures/recall-scoring.registry.ts",
  import.meta.url,
).href;
const VARIANTS: readonly {
  id: string;
  score?: AssertionScoreConfig;
  hit: number;
  miss: number;
}[] = [
  { id: "omitted", hit: 1, miss: -1 },
  { id: "empty", score: {}, hit: 1, miss: -1 },
  { id: "hit-only", score: { hit: 3 }, hit: 3, miss: -1 },
  { id: "miss-only", score: { miss: 0 }, hit: 1, miss: 0 },
  { id: "both", score: { hit: 2, miss: 0 }, hit: 2, miss: 0 },
  { id: "penalty", score: { hit: 0, miss: -1 }, hit: 0, miss: -1 },
  { id: "fractional", score: { hit: -0.5, miss: 2.5 }, hit: -0.5, miss: 2.5 },
];

function scoringCases() {
  return VARIANTS.flatMap((variant) =>
    [true, false].map((pass) => {
      const input = {
        text: pass ? "最终答案" : "不在输出中的文本",
        ...(variant.score === undefined ? {} : { score: variant.score }),
      };
      return {
        id: `${variant.id}-${pass ? "hit" : "miss"}`,
        turns: [{ send: "给出结论", expect: { "scored-text": input } }],
        expect: { "scored-text": input },
      };
    }),
  );
}

function assertResult(
  result: ScenarioResult<RecallAssertionArtifact>,
  pass: boolean,
  contribution: number,
) {
  const reason = pass ? "文本包含声明内容" : "文本缺少声明内容";
  const detail = {
    name: "scored-text",
    source: "mechanical",
    pass,
    reason,
    score: contribution,
  };
  const outcome = { name: "scored-text", pass, reason, score: pass ? 1 : 0 };
  assert.equal(result.hardPass, pass);
  assert.equal(result.artifact.rawScore, contribution * 2);
  assert.deepEqual(result.artifact.assertions, [detail, detail]);
  assert.deepEqual(result.artifact.outcomes, [
    { ...outcome, scope: "turn", turnIndex: 0 },
    { ...outcome, scope: "session" },
  ]);
}

function assertReports(
  reports: readonly ReportDocument<RecallAssertionArtifact>[],
  optIn: boolean,
  stdout: string,
) {
  assert.equal(reports.length, VARIANTS.length * 2);
  for (const variant of VARIANTS) {
    for (const pass of [true, false]) {
      const id = `mechanical-scoring/${variant.id}-${pass ? "hit" : "miss"}`;
      const row = reports.find((item) => item.rows[0]!.scenario === id)
        ?.rows[0];
      assert.ok(row, id);
      const { hit, miss } = optIn ? variant : { hit: 1, miss: -1 };
      const contribution = pass ? hit : miss;
      assertResult(row.result, pass, contribution);
      assert.equal(row.repeat?.runs, 2);
      assert.equal(row.repeat?.hardPassCount, pass ? 2 : 0);
      assert.ok(
        stdout.includes(
          `score=${pass ? 1 : 0} contribution=${contribution} reason=`,
        ),
      );
    }
  }
}

for (const optIn of [true, false]) {
  test(`机械 score 配置矩阵：opt-in=${optIn}，逐轮/最终各计一次且 repeat 独立`, async (t) => {
    const ws = await workspace(t);
    const scoreLog = join(ws.cwd, "scores.jsonl");
    const requestLog = join(ws.cwd, "requests.jsonl");
    const outDir = join(ws.cwd, "reports");
    await writeFile(scoreLog, "");
    await writeFile(requestLog, "");
    await writeFile(
      ws.registryPath,
      `import base from ${JSON.stringify(REGISTRY_URL)};
export default ${optIn ? "base" : "{ ...base, criteria: base.criteria.map(({ assertionScore, ...criterion }) => criterion) }"};
`,
    );
    await writeFile(
      ws.recallPath,
      stringify({
        version: 1,
        id: "mechanical-scoring",
        cases: scoringCases(),
      }),
    );
    const executed = await runOfficialCli(
      args(ws, outDir, ["--repeat", "2", "-vv"]),
      {
        homeDir: ws.cwd,
        env: {
          XAS_RECALL_TEST_SCORE_LOG: scoreLog,
          XAS_RECALL_TEST_JUDGE_LOG: requestLog,
        },
      },
    );
    assert.equal(executed.code, 0, executed.stderr);
    const scores = (await readFile(scoreLog, "utf8")).trim();
    assert.equal(
      scores ? scores.split("\n").length : 0,
      optIn ? VARIANTS.length * 4 : 0,
    );
    const requests = await readJudgeRequests(requestLog);
    assert.equal(requests.length, VARIANTS.length * 4);
    assert.ok(
      requests.every((request) => !request.judge),
      "机械配置不调用 Judge",
    );
    assertReports(await readReports(outDir), optIn, executed.stdout);
  });
}
