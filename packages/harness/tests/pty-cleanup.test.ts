/**
 * @module @x-agent-suite/harness/tests/pty-cleanup
 * cleanup 阶段超时回归：单阶段挂起不得阻断后续 backend/sandbox 清理。
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { cleanupSandbox, createSandbox } from "@x-agent-suite/sandbox";
import { cleanupPtyDriverResources } from "../src/pty-cleanup.ts";

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 阶段超时返回后，后台清理仍可能进行；等待其实际终态而非竞猜耗时。 */
async function assertSandboxRemoved(
  homeDir: string,
  cwd: string,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while ((existsSync(homeDir) || existsSync(cwd)) && Date.now() < deadline) {
    await delay(10);
  }
  assert.equal(
    existsSync(homeDir),
    false,
    "超时后仍必须继续清理 sandbox.homeDir",
  );
  assert.equal(existsSync(cwd), false, "超时后仍必须继续清理 sandbox.cwd");
}

test("cleanupPtyDriverResources：阶段超时后继续后续阶段并聚合错误", async () => {
  const sandbox = await createSandbox();
  let backendStopped = false;
  try {
    const cleanup = cleanupPtyDriverResources({
      profileName: "stage-timeout",
      pty: null,
      sandboxTeardown: () => new Promise(() => {}),
      backend: {
        mode: "fixture",
        start: async () => ({ baseUrl: "", apiKey: "" }),
        stop: async () => {
          backendStopped = true;
        },
      },
      sandbox,
      stageTimeoutMs: 20,
    });
    const outcome = await Promise.race([
      cleanup.then(
        () => ({ kind: "resolved" as const }),
        (error: unknown) => ({ kind: "rejected" as const, error }),
      ),
      delay(300).then(() => ({ kind: "pending" as const })),
    ]);
    assert.equal(outcome.kind, "rejected");
    if (outcome.kind === "rejected") {
      assert.ok(outcome.error instanceof AggregateError);
      assert.match(String(outcome.error), /sandboxTeardown.*超时/);
    }
    assert.equal(backendStopped, true, "超时后仍必须调用 backend.stop");
    await assertSandboxRemoved(sandbox.homeDir, sandbox.cwd);
  } finally {
    if (existsSync(sandbox.homeDir) || existsSync(sandbox.cwd)) {
      await cleanupSandbox(sandbox);
    }
  }
});
