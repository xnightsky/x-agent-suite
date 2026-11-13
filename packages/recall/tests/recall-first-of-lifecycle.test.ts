/** 组合级别 lifecycle/事件与 repeat 错误保全，零 token。 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import {
  runRecall,
  createRecallReporter,
  type RecallRunEvent,
} from "../src/index.ts";
import {
  firstOfBranches as branches,
  firstOfWorkspace,
} from "./fixtures/first-of-workspace.ts";
import {
  lifecycle,
  releaseLifecycle,
  resetLifecycle,
} from "./fixtures/recall-first-of-lifecycle.registry.ts";
const registry = new URL(
  "./fixtures/recall-first-of-lifecycle.registry.ts",
  import.meta.url,
).href;
async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}
for (const mode of [
  "close-error",
  "main-close-error",
  "factory-late",
  "start-hang",
  "send-hang",
])
  test(`组合 lifecycle ${mode} 不降级`, async (t) => {
    const tiers = branches("pass-a", "pass-b");
    Object.assign(tiers[0]!.expect.judge, {
      timeoutMs: mode.includes("error") ? 1000 : 15,
    });
    const ws = await firstOfWorkspace(t, { firstOf: { quality: tiers } });
    resetLifecycle(mode);
    t.after(releaseLifecycle);
    await writeFile(
      ws.registryPath,
      `export { default } from ${JSON.stringify(registry)};`,
    );
    const result = await runRecall(ws.options);
    assert.equal(result.runs.length, 0);
    const failure = result.failures[0]!;
    assert.ok(failure.reports);
    let diagnostic = JSON.parse(
      await readFile(failure.reports.jsonPath, "utf8"),
    );
    assert.equal(diagnostic.compositions[0].commonMiss, -1);
    if (mode === "factory-late") {
      assert.equal(diagnostic.cleanup[0].status, "pending");
      releaseLifecycle();
      // 等待测试夹具 gate 触发的确定性清理与串行诊断写盘，不触发模型重跑。
      for (
        let count = 0;
        count < 30 &&
        !diagnostic.cleanup.some(
          (item: { status: string }) => item.status === "closed",
        );
        count++
      ) {
        await flush();
        diagnostic = JSON.parse(
          await readFile(failure.reports.jsonPath, "utf8"),
        );
      }
      assert.ok(
        diagnostic.cleanup.some(
          (item: { status: string }) => item.status === "closed",
        ),
      );
      assert.equal(lifecycle.includes("judge:start"), false);
      assert.equal(lifecycle.includes("judge:send"), false);
    }
    if (mode === "main-close-error")
      assert.equal(lifecycle.includes("judge:factory"), false);
    else
      assert.equal(
        lifecycle.filter((item) => item === "judge:factory").length,
        1,
      );
    assert.equal("rawScore" in diagnostic, false);
  });
test("第二次 repeat 错误保留第一次成绩，不执行剩余 repeat", async (t) => {
  const ws = await firstOfWorkspace(t, {
    firstOf: { quality: branches("pass-a", "pass-b") },
  });
  resetLifecycle("repeat-error");
  await writeFile(
    ws.registryPath,
    `export { default } from ${JSON.stringify(registry)};`,
  );
  const result = await runRecall({ ...ws.options, repeat: 3 });
  assert.equal(result.runs.length, 0);
  const diagnostic = JSON.parse(
    await readFile(result.failures[0]!.reports!.jsonPath, "utf8"),
  );
  assert.equal(diagnostic.repeatIndex, 1);
  assert.equal(diagnostic.completedRepeats.length, 1);
  assert.equal(diagnostic.completedRepeats[0].rawScore, 3);
  assert.equal(diagnostic.pendingRepeats[0].index, 2);
  assert.deepEqual(diagnostic.repeatSummary, {
    planned: 3,
    valid: 1,
    invalid: 1,
    skipped: 1,
    coverage: 1 / 3,
    invalidRate: 1 / 3,
    passRate: 1,
    rawScore: { mean: 3, min: 3, max: 3 },
    passAtK: true,
    passAllK: false,
  });
  assert.deepEqual(result.failures[0]!.scoreSummary, diagnostic.repeatSummary);
  assert.equal(result.summary.valid, 0);
  assert.equal(result.summary.invalid, 1);
  assert.equal(result.summary.passRate, null);
  assert.equal(lifecycle.filter((item) => item === "main:factory").length, 2);
});
test("所有 verbosity 由相同事件渲染，快照不随低档执行改写", async (t) => {
  const ws = await firstOfWorkspace(t, {
    firstOf: { quality: branches("fail-a", "pass-b") },
  });
  const events: RecallRunEvent[] = [];
  const result = await runRecall(ws.options, (event) => events.push(event));
  assert.equal(result.failures.length, 0);
  const compositions = events.filter((event) => event.type === "composition");
  assert.deepEqual(
    compositions.map((event) => event.event.sequence),
    compositions.map((_, index) => index + 1),
  );
  assert.equal(
    compositions[0]!.event.composition.branches[1]!.status,
    "pending",
  );
  const completed = compositions.at(-1)!.event;
  assert.equal(completed.assertion!.score, 1);
  for (const level of [0, 1, 2, 3] as const) {
    const stdout: string[] = [],
      stderr: string[] = [];
    const reporter = createRecallReporter(level, {
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
      isTTY: false,
    });
    events.forEach(reporter);
    assert.match(stdout.join("\n"), /rawScore=1/);
    if (level)
      assert.match(stdout.join("\n"), /accepted=downgrade contribution=1/);
    if (level >= 2) assert.match(stdout.join("\n"), /branch-started.*standard/);
    assert.equal(stderr.length, 0);
  }
});
test("composition listener 异常保留 ERROR 树且不进入降级", async (t) => {
  const ws = await firstOfWorkspace(t, {
    firstOf: { quality: branches("pass-a", "pass-b") },
  });
  const result = await runRecall(ws.options, (event) => {
    if (event.type === "composition" && event.event.phase === "branch-skipped")
      throw new Error("listener failed");
  });
  const diagnostic = JSON.parse(
    await readFile(result.failures[0]!.reports!.jsonPath, "utf8"),
  );
  assert.equal(diagnostic.compositions[0].status, "error");
  assert.equal(diagnostic.compositions[0].accepted, null);
});
