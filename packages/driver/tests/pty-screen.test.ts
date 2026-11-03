/**
 * @module @x-agent-suite/driver/tests/pty-screen
 * PtyScreen 取消语义回归：dispose 必须拒绝所有进行中的 waitForScreen。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createPtyScreen } from "../src/pty-screen.ts";

test("PtyScreen：dispose 立即取消 waitForScreen，而不是等到 timeout", async () => {
  const screen = createPtyScreen();
  const startedAt = Date.now();
  const waiting = screen.waitForScreen(/never-appears/, 1_000).then(
    () => ({ kind: "resolved" as const }),
    (error: unknown) => ({ kind: "rejected" as const, error }),
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  screen.dispose();
  const outcome = await Promise.race([
    waiting,
    new Promise<{ kind: "pending" }>((resolve) =>
      setTimeout(() => resolve({ kind: "pending" }), 150),
    ),
  ]);
  assert.equal(outcome.kind, "rejected");
  if (outcome.kind === "rejected") {
    assert.match(String(outcome.error), /dispose|已释放|取消/i);
  }
  assert.ok(Date.now() - startedAt < 500, "dispose 后不应等满原 timeout");
});

test("PtyScreen：已有内容时立即匹配，超时等待正常清理", async () => {
  const screen = createPtyScreen();
  screen.feed("hello pty");
  await screen.waitForScreen(/hello pty/, 100);
  await assert.rejects(
    screen.waitForScreen(/never-appears/, 20),
    /等待屏幕内容超时/,
  );
  screen.dispose();
});
