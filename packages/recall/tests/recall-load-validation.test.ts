/** Recall 选项严格路径/approveLive 校验回归。 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { main } from "../src/cli.ts";
import { runRecall } from "../src/run.ts";
import { args, state, workspace } from "./fixtures/recall-workspace.ts";

function loadOptions(
  ws: Awaited<ReturnType<typeof workspace>>,
  index: number,
): Record<string, unknown> {
  return {
    cwd: ws.cwd,
    homeDir: ws.cwd,
    target: ws.recallPath,
    selection: { carrier: "fixture-carrier" },
    liveConfigPath: ws.livePath,
    registryPath: ws.registryPath,
    outDir: join(ws.cwd, "reports-" + index),
  };
}

test("Recall 空路径、executionParams:null 与字符串 approveLive 在 Driver 前拒绝", async (t) => {
  const ws = await workspace(t);
  const invalidOverrides: Record<string, unknown>[] = [
    { cwd: "" },
    { homeDir: "" },
    { target: "" },
    { liveConfigPath: "" },
    { registryPath: "" },
    { planPath: "" },
    { rootDir: "" },
    { outDir: "" },
    { executionParams: null },
    { approveLive: "false" },
    { approveLive: 1 },
    { approveLive: null },
  ];
  for (const [index, override] of invalidOverrides.entries()) {
    const options = { ...loadOptions(ws, index), ...override };
    await assert.rejects(
      () => runRecall(options as never),
      override.approveLive === undefined
        ? /非空字符串|executionParams|JSON/
        : /approveLive|boolean/i,
      JSON.stringify(override),
    );
    assert.equal(state().transports.length, 0);
    assert.equal(state().profiles.length, 0);
    assert.equal(state().factoryCalls.length, 0);
  }
});

test("CLI 空 live-config 与空 target 返回定义错误且零驱动", async (t) => {
  const ws = await workspace(t);
  const errors: string[] = [];
  t.mock.method(console, "error", (message: string) => errors.push(message));
  const emptyLive = [
    "--carrier",
    "fixture-carrier",
    "--live-config",
    "",
    "--registry",
    ws.registryPath,
    "--out-dir",
    join(ws.cwd, "reports-empty-live"),
    ws.recallPath,
  ];
  assert.equal(await main(emptyLive, { cwd: ws.cwd, homeDir: ws.cwd }), 2);
  assert.match(errors.join("\n"), /非空字符串/);
  assert.equal(state().transports.length, 0);
  assert.equal(state().profiles.length, 0);

  const emptyTarget = [
    "--carrier",
    "fixture-carrier",
    "--live-config",
    ws.livePath,
    "--registry",
    ws.registryPath,
    "--out-dir",
    join(ws.cwd, "reports-empty-target"),
    "",
  ];
  assert.equal(await main(emptyTarget, { cwd: ws.cwd, homeDir: ws.cwd }), 2);
  assert.match(errors.join("\n"), /target|非空字符串/);
  assert.equal(state().transports.length, 0);
});
