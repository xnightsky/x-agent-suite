/**
 * @module @x-agent-suite/recall/tests/recall-turn-assertion
 * 线性逐轮内置 Judge 的官方 CLI 纵向验收：评价时机、文本、位置归因、计分与错误清理。
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { stringify } from "yaml";
import { runOfficialCli } from "./fixtures/official-cli.ts";
import { args, readReports, workspace } from "./fixtures/recall-workspace.ts";
import { readJudgeRequests } from "./fixtures/recall-judge.registry.ts";

const REGISTRY_URL = new URL(
  "./fixtures/recall-judge.registry.ts",
  import.meta.url,
).href;

async function prepare(
  t: Parameters<typeof workspace>[0],
  definition: unknown,
) {
  const ws = await workspace(t);
  await writeFile(
    ws.registryPath,
    "export { default } from " + JSON.stringify(REGISTRY_URL) + "\n",
  );
  await writeFile(ws.recallPath, stringify(definition));
  const requestLog = join(ws.cwd, "requests.jsonl");
  await writeFile(requestLog, "");
  return { ws, requestLog };
}

test("逐轮即时评价：文本、顺序、位置归因与跨轮计分对齐", async (t) => {
  const { ws, requestLog } = await prepare(t, {
    version: 1,
    id: "turn-assertion",
    cases: [
      {
        id: "linear",
        turns: [
          {
            send: "准备回答",
            expect: { judge: { "ai-a": { rubric: "准备标准" } } },
          },
          {
            send: "给出结论",
            expect: {
              "text-contains": ["最终答案"],
              judge: {
                "ai-a": { rubric: "答案标准" },
                "ai-b": { rubric: "失败标准", score: { miss: 0 } },
              },
            },
          },
        ],
        expect: {
          judge: { "ai-a": { rubric: "最终标准", score: { hit: 3 } } },
        },
      },
    ],
  });
  const outDir = join(ws.cwd, "reports");
  const executed = await runOfficialCli(args(ws, outDir), {
    homeDir: ws.cwd,
    env: { XAS_RECALL_TEST_JUDGE_LOG: requestLog },
  });
  assert.equal(executed.code, 0, executed.stderr);

  const requests = await readJudgeRequests(requestLog);
  assert.deepEqual(
    requests.map((request) => request.judge),
    [false, true, false, true, true],
    "第一轮 Judge 必须先于第二次 send；内容失败不阻断后续与 case Judge",
  );
  const judges = requests.filter((request) => request.judge);
  assert.match(judges[0]!.prompt, /中间答案/);
  assert.doesNotMatch(judges[0]!.prompt, /最终答案/);
  assert.match(judges[1]!.prompt, /最终答案/);
  assert.match(judges[2]!.prompt, /最终答案/);
  assert.notEqual(judges[1]!.prompt, judges[2]!.prompt);
  assert.ok(judges.every((request) => request.messageCount === 1));

  const [report] = await readReports(outDir);
  const result = report.rows[0].result;
  assert.equal(result.hardPass, false);
  assert.equal(result.artifact.rawScore, 6);
  assert.deepEqual(
    result.artifact.outcomes.map(
      (outcome: { scope: string; turnIndex?: number }) => ({
        scope: outcome.scope,
        turnIndex: outcome.turnIndex,
      }),
    ),
    [
      { scope: "turn", turnIndex: 0 },
      { scope: "turn", turnIndex: 1 },
      { scope: "turn", turnIndex: 1 },
      { scope: "turn", turnIndex: 1 },
      { scope: "session", turnIndex: undefined },
    ],
  );
  assert.deepEqual(
    result.artifact.assertions.map(
      (item: { name: string; source: string; score: number }) => ({
        name: item.name,
        source: item.source,
        score: item.score,
      }),
    ),
    [
      { name: "turn.0.judge.ai-a", source: "ai", score: 1 },
      { name: "text-contains", source: "mechanical", score: 1 },
      { name: "turn.1.judge.ai-a", source: "ai", score: 1 },
      { name: "turn.1.judge.ai-b", source: "ai", score: 0 },
      { name: "judge.ai-a", source: "ai", score: 3 },
    ],
  );
});

test("逐轮 Judge 评测错误：不再 send 后续轮次且不写正常报告", async (t) => {
  const { ws, requestLog } = await prepare(t, {
    version: 1,
    id: "turn-error",
    cases: [
      {
        id: "stop-on-error",
        turns: [
          {
            send: "准备回答",
            expect: { judge: { "ai-a": { rubric: "准备标准" } } },
          },
          { send: "不得执行" },
        ],
      },
    ],
  });
  const outDir = join(ws.cwd, "reports");
  const executed = await runOfficialCli(args(ws, outDir), {
    homeDir: ws.cwd,
    env: {
      XAS_RECALL_TEST_JUDGE_LOG: requestLog,
      XAS_RECALL_TEST_JUDGE_MODE: "call",
    },
  });
  assert.equal(executed.code, 1, executed.stdout + executed.stderr);
  const requests = await readJudgeRequests(requestLog);
  assert.deepEqual(
    requests.map((request) => request.judge),
    [false, true],
  );
  await assert.rejects(readReports(outDir));
});

test("repeat 重建主执行与每个逐轮 Judge 评价点", async (t) => {
  const { ws, requestLog } = await prepare(t, {
    version: 1,
    id: "turn-repeat",
    cases: [
      {
        id: "repeat",
        turns: [
          {
            send: "准备回答",
            expect: { judge: { "ai-a": { rubric: "准备标准" } } },
          },
        ],
      },
    ],
  });
  const outDir = join(ws.cwd, "reports");
  const executed = await runOfficialCli(args(ws, outDir, ["--repeat", "2"]), {
    homeDir: ws.cwd,
    env: { XAS_RECALL_TEST_JUDGE_LOG: requestLog },
  });
  assert.equal(executed.code, 0, executed.stderr);
  const requests = await readJudgeRequests(requestLog);
  assert.deepEqual(
    requests.map((request) => request.judge),
    [false, true, false, true],
  );
  const [report] = await readReports(outDir);
  assert.equal(report.rows[0].result.artifact.rawScore, 1);
});

test("旧 case 沿用机械名，AI 使用 turnIndex", async (t) => {
  const { ws, requestLog } = await prepare(t, {
    version: 1,
    id: "legacy-linear",
    cases: [
      {
        id: "legacy",
        turns: [
          {
            send: "准备回答",
            expect: {
              "text-contains": ["中间答案"],
              judge: { "ai-a": { rubric: "准备标准" } },
            },
          },
        ],
      },
    ],
  });
  const outDir = join(ws.cwd, "reports");
  const executed = await runOfficialCli(args(ws, outDir), {
    homeDir: ws.cwd,
    env: { XAS_RECALL_TEST_JUDGE_LOG: requestLog },
  });
  assert.equal(executed.code, 0, executed.stderr);
  assert.deepEqual(
    (await readJudgeRequests(requestLog)).map((request) => request.judge),
    [false, true],
  );
  const [report] = await readReports(outDir);
  const assertions = report.rows[0].result.artifact.assertions;
  assert.deepEqual(
    assertions.map((item: { name: string }) => item.name),
    ["text-contains", "turn.0.judge.ai-a"],
  );
  assert.equal(report.rows[0].result.artifact.rawScore, 2);
});

test("落盘 recall.yaml：线性逐轮 DSL 案例经官方 CLI 验收", async (t) => {
  const ws = await workspace(t);
  await writeFile(
    ws.registryPath,
    "export { default } from " + JSON.stringify(REGISTRY_URL) + "\n",
  );
  await writeFile(
    ws.recallPath,
    await readFile(
      new URL("./fixtures/turn-assertion/.recall.yaml", import.meta.url),
      "utf8",
    ),
  );
  const requestLog = join(ws.cwd, "requests.jsonl");
  await writeFile(requestLog, "");
  const outDir = join(ws.cwd, "reports");
  const executed = await runOfficialCli(args(ws, outDir), {
    homeDir: ws.cwd,
    env: { XAS_RECALL_TEST_JUDGE_LOG: requestLog },
  });
  assert.equal(executed.code, 0, executed.stderr);
  assert.deepEqual(
    (await readJudgeRequests(requestLog)).map((request) => request.judge),
    [false, true, false, true, true],
  );
  const [report] = await readReports(outDir);
  const result = report.rows[0].result;
  assert.equal(result.artifact.rawScore, 5);
  assert.deepEqual(
    result.artifact.assertions.map((item: { name: string }) => item.name),
    ["turn.0.judge.ai-a", "text-contains", "turn.1.judge.ai-b", "judge.ai-a"],
  );
});
