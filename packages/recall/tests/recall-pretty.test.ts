/** Recall TTY 美化与实时状态、非 TTY 纯文本兼容性回归。 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { createRecallReporter } from "../src/reporter.ts";
import type { RecallReporterOutput } from "../src/reporter.ts";
import { runRecall } from "../src/run.ts";
import { workspace } from "./fixtures/recall-workspace.ts";

function options(ws: Awaited<ReturnType<typeof workspace>>) {
  return {
    cwd: ws.cwd,
    homeDir: ws.cwd,
    target: ws.recallPath,
    selection: { carrier: "fixture-carrier" },
    liveConfigPath: ws.livePath,
    registryPath: ws.registryPath,
    outDir: join(ws.cwd, "reports-pretty"),
  };
}

test("TTY case 开始立即显示状态，完成后清行并输出图标结果和汇总框", async (t) => {
  const ws = await workspace(t);
  const stdout: string[] = [];
  const stderr: string[] = [];
  const control: string[] = [];
  const sequence: string[] = [];
  const output: RecallReporterOutput = {
    stdout: (message) => {
      stdout.push(message);
      sequence.push("line:" + message);
    },
    stderr: (message) => stderr.push(message),
    isTTY: true,
    color: true,
    writeStdout: (chunk) => {
      control.push(chunk);
      sequence.push("control:" + chunk);
    },
  };

  await runRecall(options(ws), createRecallReporter(1, output));

  assert.ok(
    control.some((chunk) => chunk.includes("1/1 alpha/pass")),
    JSON.stringify(control),
  );
  assert.ok(control.some((chunk) => chunk.includes("\u001b[2K")));
  const repeatLog = sequence.findIndex(
    (item) => item.startsWith("line:") && item.includes("REPEAT 1/1 START"),
  );
  assert.ok(repeatLog > 0, JSON.stringify(sequence));
  assert.equal(sequence[repeatLog - 1], "control:\r\u001b[2K");
  const text = stdout.join("\n");
  assert.match(text, /✓ PASS alpha\/pass/);
  assert.match(text, /rawScore=1 assertions=1\/1/);
  assert.match(text, /\u001b\[32m/);
  assert.match(text, /╭/);
  assert.match(text, /1 passed/);
  assert.match(text, /0 failed/);
  assert.doesNotMatch(text, /SUMMARY total=/);
  assert.equal(stderr.join("\n"), "");
});

test("非 TTY 保持纯文本，不写状态控制或 ANSI 颜色", async (t) => {
  const ws = await workspace(t);
  const stdout: string[] = [];
  const control: string[] = [];
  const output: RecallReporterOutput = {
    stdout: (message) => stdout.push(message),
    stderr: () => {},
    isTTY: false,
    color: false,
    writeStdout: (chunk) => control.push(chunk),
  };

  await runRecall(options(ws), createRecallReporter(0, output));

  const text = stdout.join("\n");
  assert.match(text, /^RECALL cases=1 targets=1 repeat=1/m);
  assert.match(text, /^PASS alpha\/pass .*rawScore=1 assertions=1\/1/m);
  assert.match(text, /^SUMMARY total=1 passed=1 failed=0 errors=0/m);
  assert.doesNotMatch(text, /✓|✗|╭|\u001b\[/);
  assert.deepEqual(control, []);
});
