/**
 * @module @x-agent-suite/recall/tests/recall-assembly
 * 通用判据工厂的官方 CLI 装配路径：合成 registry + fake profile driver，零 token 零网络。
 * 不变量：
 * - 工厂每 target 恰好装配一次，全部完成于任何主 Driver 创建之前；
 * - 装配上下文与主执行同源（target/config/tags/同一归一化批准/effects）；
 * - 装配失败中止本次运行，错误只含 scope:name 与阶段，不回显 context/config。
 */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { main } from "../src/cli.ts";
import { runRecall } from "../src/run.ts";
import {
  workspace,
  args,
  state,
  resetState,
  readReports,
} from "./fixtures/recall-workspace.ts";

const REGISTRY_FIXTURE_URL = new URL(
  "./fixtures/recall.registry.ts",
  import.meta.url,
).href;

/** 两 case 引用动态判据工厂的考卷。 */
const ECHO_FILE = `version: 1
id: alpha
cases:
  - id: one
    turns:
      - send: hello
        expect:
          fixture-echo: hello
  - id: two
    turns:
      - send: hello
        expect:
          fixture-echo: hello
`;

test("动态判据工厂按 target 装配一次，repeat>1 与多 case 复用同一闭包", async (t) => {
  const ws = await workspace(t);
  await writeFile(ws.recallPath, ECHO_FILE);
  const outDir = join(ws.cwd, "reports-echo");
  assert.equal(
    await main(args(ws, outDir, ["--repeat", "2"]), {
      cwd: ws.cwd,
      homeDir: ws.cwd,
    }),
    0,
  );
  assert.equal(state().factoryCalls.length, 1, "工厂每 target 只装配一次");
  assert.equal(state().factoryCalls[0]!.clientRef, "fixture-direct");
  assert.equal(state().factoryCalls[0]!.liveReviewApproved, false);
  assert.equal(state().transports.length, 4, "主 Driver 仍按 case×repeat 创建");
  const reports = await readReports(outDir);
  assert.equal(reports.length, 2);
  assert.ok(reports.every((report) => report.rows[0].result.hardPass));
});

test("装配出的判据真实参与评分：expect 未命中判 FAIL 且报告留痕", async (t) => {
  const ws = await workspace(t);
  await writeFile(
    ws.recallPath,
    `version: 1
id: alpha
cases:
  - id: miss
    turns:
      - send: hello
        expect:
          fixture-echo: goodbye
`,
  );
  const outDir = join(ws.cwd, "reports-miss");
  assert.equal(
    await main(args(ws, outDir), {
      cwd: ws.cwd,
      homeDir: ws.cwd,
    }),
    0,
    "内容未通过属正常执行，退出码只看基础设施失败",
  );
  assert.equal(state().factoryCalls.length, 1);
  const [report] = await readReports(outDir);
  assert.equal(report.rows[0].result.hardPass, false);
  assert.match(report.rows[0].result.error, /未命中 expect/);
});

test("未引用工厂零调用：既有考卷只跑静态判据", async (t) => {
  const ws = await workspace(t);
  assert.equal(
    await main(args(ws, join(ws.cwd, "reports-static")), {
      cwd: ws.cwd,
      homeDir: ws.cwd,
    }),
    0,
  );
  assert.equal(state().factoryCalls.length, 0);
});

test("装配失败在任何主 Driver 创建前中止，错误只含判据名与阶段", async (t) => {
  const ws = await workspace(t);
  await writeFile(
    ws.recallPath,
    `version: 1
id: alpha
cases:
  - id: boom
    turns:
      - send: hello
        expect:
          fixture-broken: true
`,
  );
  await writeFile(
    ws.registryPath,
    `import base from ${JSON.stringify(REGISTRY_FIXTURE_URL)};
export default {
  ...base,
  criteria: [
    ...base.criteria,
    {
      name: "fixture-broken",
      scope: "turn",
      create: () => {
        throw new Error("plugin-secret-detail");
      },
    },
  ],
};
`,
  );
  await assert.rejects(
    runRecall({
      cwd: ws.cwd,
      homeDir: ws.cwd,
      selection: { carrier: "fixture-carrier" },
      liveConfigPath: ws.livePath,
      registryPath: ws.registryPath,
      target: ws.recallPath,
      outDir: join(ws.cwd, "reports-boom"),
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /turn:fixture-broken/);
      assert.match(error.message, /阶段：create/);
      assert.doesNotMatch(error.message, /plugin-secret-detail/);
      return true;
    },
  );
  assert.equal(state().transports.length, 0);
  assert.equal(state().profiles.length, 0);
  assert.equal(state().factoryCalls.length, 0);

  resetState();
  assert.equal(
    await main(args(ws, join(ws.cwd, "reports-boom-cli")), {
      cwd: ws.cwd,
      homeDir: ws.cwd,
    }),
    2,
  );
  assert.equal(state().transports.length, 0);
  assert.equal(state().profiles.length, 0);
});

test("--approve-live 同一批准同时进入主执行与装配上下文", async (t) => {
  const ws = await workspace(t, { livePolicy: "review-required" });
  await writeFile(ws.recallPath, ECHO_FILE);
  assert.equal(
    await main(args(ws, join(ws.cwd, "reports-denied-echo")), {
      cwd: ws.cwd,
      homeDir: ws.cwd,
    }),
    2,
  );
  assert.equal(state().transports.length, 0);
  assert.equal(state().factoryCalls.length, 0);

  resetState();
  assert.equal(
    await main(
      args(ws, join(ws.cwd, "reports-approved-echo"), ["--approve-live"]),
      {
        cwd: ws.cwd,
      },
    ),
    0,
  );
  assert.equal(state().factoryCalls.length, 1);
  assert.equal(state().factoryCalls[0]!.liveReviewApproved, true);
  assert.equal(state().transports.length, 2);
});

test("borrowed 执行把 cliRef 与 effects 交给同源装配上下文", async (t) => {
  const ws = await workspace(t, { provision: true });
  await writeFile(ws.recallPath, ECHO_FILE);
  const outDir = join(ws.cwd, "reports-echo-borrowed");
  assert.equal(
    await main(args(ws, outDir, ["--repeat", "2"]), {
      cwd: ws.cwd,
      homeDir: ws.cwd,
    }),
    0,
  );
  assert.equal(state().factoryCalls.length, 1);
  assert.equal(state().factoryCalls[0]!.cliRef, "fixture-cli-0");
  assert.equal(state().factoryCalls[0]!.clientRef, undefined);
  assert.equal(state().factoryCalls[0]!.effects, "none");
  assert.ok(
    state().factoryCalls[0]!.tagCliIds.includes("fixture-cli-0"),
    "装配上下文的 catalog 须与执行决策同源（live 私有 overlay 的 cli 实例）",
  );
  assert.equal(state().profiles.length, 4, "主 Driver 仍按 case×repeat 创建");
  assert.equal(state().transports.length, 0);
});
