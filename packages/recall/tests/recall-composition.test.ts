/** allOf/anyOf/firstOf 的落盘 YAML、公开 CLI、报告与调用顺序，零 token。 */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { args, readReports } from "./fixtures/recall-workspace.ts";
import { runOfficialCli } from "./fixtures/official-cli.ts";
import { readJudgeRequests } from "./fixtures/recall-judge.registry.ts";
import { firstOfWorkspace } from "./fixtures/first-of-workspace.ts";
import type { RecallComposition } from "../src/index.ts";

function judged(
  name: string,
  branchName: string,
  rubric: string,
  score: { hit: number; miss: number },
) {
  return {
    name: branchName,
    score,
    expect: { judge: { maxRetries: 0, rubrics: { [rubric]: { rubric } } } },
  };
}

async function execute(
  t: TestContext,
  expect: object,
  extra: readonly string[] = [],
  turns: object[] = [{ send: "same answer" }],
) {
  const ws = await firstOfWorkspace(t, expect, turns);
  const cli = await runOfficialCli(args(ws, ws.outDir, extra), {
    homeDir: ws.cwd,
    env: { XAS_RECALL_TEST_JUDGE_LOG: ws.log },
  });
  assert.equal(cli.code, 0, cli.stdout + cli.stderr);
  const reports = await readReports(ws.outDir);
  const report = reports[0];
  assert.ok(report, cli.stdout + cli.stderr);
  const md = (await readdir(ws.outDir, { recursive: true })).find((path) =>
    path.endsWith("-report.md"),
  );
  assert.ok(md);
  return {
    artifact: report.rows[0].result.artifact,
    result: report.rows[0].result,
    requests: await readJudgeRequests(ws.log),
    cli,
    markdown: await readFile(join(ws.outDir, md), "utf8"),
  };
}

test("case 三种组合与兄弟断言并列，anyOf 取最高、firstOf hit=0 继续", async (t) => {
  const run = await execute(t, {
    allOf: {
      required: [
        judged("all", "a", "pass-a", { hit: 2, miss: -1 }),
        judged("all", "b", "pass-b", { hit: 3, miss: -1 }),
      ],
    },
    anyOf: {
      best: [
        judged("any", "a", "pass-a", { hit: 1, miss: -1 }),
        judged("any", "b", "pass-b", { hit: 3, miss: -1 }),
      ],
    },
    firstOf: {
      zero: [
        judged("first", "standard", "pass-a", { hit: 0, miss: -1 }),
        judged("first", "downgrade", "pass-b", { hit: 1, miss: -1 }),
      ],
    },
    "mechanical-a": {},
  });
  assert.equal(run.result.hardPass, true);
  assert.equal(run.artifact.rawScore, 10);
  assert.equal(run.artifact.assertions.length, 4);
  assert.equal(run.requests.filter((item) => item.judge).length, 6);
  const compositions = new Map<string, RecallComposition>(
    run.artifact.compositions.map((item: RecallComposition) => [
      item.assertionName,
      item,
    ]),
  );
  const all = compositions.get("allOf.required");
  const any = compositions.get("anyOf.best");
  const first = compositions.get("firstOf.zero");
  assert.ok(all && any && first);
  assert.equal(all.kind, "allOf");
  assert.equal(all.status, "passed");
  assert.equal(all.accepted, null);
  assert.deepEqual(
    all.branches.map((branch) => branch.contribution),
    [2, 3],
  );
  assert.equal(any.kind, "anyOf");
  assert.equal(any.accepted, "b");
  assert.equal(any.commonMiss, -1);
  assert.equal(first.kind, "firstOf");
  assert.equal(first.accepted, "downgrade");
  assert.equal(first.branches[0]!.result?.pass, true);
  assert.equal(first.branches[0]!.contribution, 0);
  assert.equal(first.branches[1]!.contribution, 1);
  assert.match(run.markdown, /allOf.required/);
  assert.match(run.cli.stdout, /rawScore=10/);
});

test("allOf 原始 false 与组合 FAIL 并存，miss=0 不丢失且不误放行", async (t) => {
  const run = await execute(t, {
    allOf: {
      quality: [
        judged("all", "a", "pass-a", { hit: 2, miss: -1 }),
        judged("all", "b", "fail-a", { hit: 3, miss: 0 }),
      ],
    },
  });
  assert.equal(run.result.hardPass, false);
  assert.equal(run.artifact.rawScore, 2);
  assert.equal(run.artifact.compositions[0].status, "failed");
  assert.equal(run.artifact.compositions[0].branches[1].result.pass, false);
  assert.equal(run.artifact.compositions[0].branches[1].contribution, 0);
  assert.equal(run.artifact.assertions.length, 1);
  assert.equal(run.artifact.assertions[0].score, 2);
});

test("省略分支 score 时 firstOf 按内部叶子实际贡献求和并继续", async (t) => {
  const run = await execute(t, {
    firstOf: {
      leaves: [
        {
          name: "standard",
          expect: {
            judge: {
              maxRetries: 0,
              rubrics: {
                "pass-a": { rubric: "pass-a", score: { hit: 1, miss: -1 } },
                "fail-a": { rubric: "fail-a", score: { hit: 3, miss: -1 } },
              },
            },
          },
        },
        {
          name: "downgrade",
          expect: {
            judge: {
              maxRetries: 0,
              rubrics: {
                "pass-b": { rubric: "pass-b", score: { hit: 2, miss: -2 } },
              },
            },
          },
        },
      ],
    },
  });
  assert.equal(run.result.hardPass, true);
  assert.equal(run.artifact.rawScore, 2);
  const composition = run.artifact.compositions[0];
  assert.equal(composition.accepted, "downgrade");
  assert.equal(composition.commonMiss, -2);
  assert.equal(composition.branches[0].result.pass, false);
  assert.equal(composition.branches[0].contribution, 0);
  assert.equal(composition.branches[0].scoreSource, "leaves");
  assert.equal(composition.branches[0].conditions.length, 2);
  assert.equal(composition.branches[1].contribution, 2);
  assert.equal(run.requests.filter((item) => item.judge).length, 2);
});

test("turn 三种组合完成后才进入下一轮并保留 scope/turnIndex", async (t) => {
  const run = await execute(
    t,
    {},
    [],
    [
      {
        send: "first",
        expect: {
          allOf: {
            required: [{ name: "a", expect: { "text-contains": ["first"] } }],
          },
          anyOf: {
            fallback: [
              {
                name: "a",
                score: { hit: 1, miss: -1 },
                expect: { "text-contains": ["missing"] },
              },
              {
                name: "b",
                score: { hit: 2, miss: -1 },
                expect: { "text-contains": ["first"] },
              },
            ],
          },
          firstOf: {
            zero: [
              {
                name: "a",
                score: { hit: 0, miss: -1 },
                expect: { "text-contains": ["first"] },
              },
              {
                name: "b",
                score: { hit: 1, miss: -1 },
                expect: { "text-contains": ["first"] },
              },
            ],
          },
        },
      },
      { send: "second" },
    ],
  );
  assert.equal(run.result.hardPass, true);
  assert.equal(run.artifact.rawScore, 4);
  assert.deepEqual(
    run.artifact.compositions
      .map((item: { assertionName: string }) => item.assertionName)
      .sort(),
    ["turn.0.allOf.required", "turn.0.anyOf.fallback", "turn.0.firstOf.zero"],
  );
  assert.ok(
    run.artifact.compositions.every(
      (item: { scope: string; turnIndex: number }) =>
        item.scope === "turn" && item.turnIndex === 0,
    ),
  );
  assert.deepEqual(
    run.requests.map((item) => item.judge),
    [false, false],
  );
});
