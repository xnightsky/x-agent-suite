/**
 * @module @x-agent-suite/recall/tests/recall-judge-errors
 * 必需裁定/判据结果缺失与调用、超时、解析失败的 CLI 错误分界。
 */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { stringify } from "yaml";
import { args, readReports, workspace } from "./fixtures/recall-workspace.ts";
import { runOfficialCli } from "./fixtures/official-cli.ts";
import { readJudgeRequests } from "./fixtures/recall-judge.registry.ts";

const REGISTRY_URL = new URL(
  "./fixtures/recall-judge.registry.ts",
  import.meta.url,
).href;

async function runJudgeError(t: TestContext, mode: string) {
  const ws = await workspace(t);
  await writeFile(
    ws.registryPath,
    "export { default } from " + JSON.stringify(REGISTRY_URL) + ";\n",
  );
  await writeFile(
    ws.recallPath,
    stringify({
      version: 1,
      id: "judge-error",
      cases: [
        {
          id: mode,
          turns: [{ send: "answer" }],
          expect: {
            judge: {
              timeoutMs: mode === "timeout" ? 5 : 1000,
              maxRetries: 0,
              rubrics: {
                "ai-a": { rubric: "甲标准" },
                "ai-b": { rubric: "乙标准" },
              },
            },
          },
        },
      ],
    }),
  );
  const requestLog = join(ws.cwd, "requests.jsonl");
  await writeFile(requestLog, "");
  const outDir = join(ws.cwd, "reports");
  const executed = await runOfficialCli(args(ws, outDir), {
    homeDir: ws.cwd,
    env: {
      XAS_RECALL_TEST_JUDGE_LOG: requestLog,
      XAS_RECALL_TEST_JUDGE_MODE: mode,
    },
  });
  assert.equal(executed.code, 1, executed.stdout + executed.stderr);
  assert.match(executed.stderr, /ERROR|absent|not-evaluated/);
  assert.ok((await readJudgeRequests(requestLog)).some((item) => item.judge));
  await assert.rejects(readReports(outDir), "不得写出正常评分报告");
}

test("缺必需裁定、调用失败、解析失败与超时均为 CLI=1 评测错误", async (t) => {
  for (const mode of ["absent", "call", "parse", "timeout"]) {
    await runJudgeError(t, mode);
  }
});

test("机械判据未产出结果是 CLI=1，不伪装成 miss 或 0 分", async (t) => {
  const ws = await workspace(t);
  await writeFile(
    ws.registryPath,
    "import base from " +
      JSON.stringify(REGISTRY_URL) +
      ";\n" +
      "export default { ...base, criteria: [...base.criteria, { name: 'broken', scope: 'session', evaluate: () => undefined }] };\n",
  );
  await writeFile(
    ws.recallPath,
    stringify({
      version: 1,
      id: "criterion-error",
      cases: [
        {
          id: "missing-result",
          turns: [{ send: "answer" }],
          expect: { broken: {} },
        },
      ],
    }),
  );
  const requestLog = join(ws.cwd, "requests.jsonl");
  await writeFile(requestLog, "");
  const outDir = join(ws.cwd, "reports");
  const executed = await runOfficialCli(args(ws, outDir), {
    homeDir: ws.cwd,
    env: { XAS_RECALL_TEST_JUDGE_LOG: requestLog },
  });
  assert.equal(executed.code, 1, executed.stdout + executed.stderr);
  assert.match(executed.stderr, /结果|score|pass|reason/);
  await assert.rejects(readReports(outDir), "畸形判据结果不得进入正常报告");
});
