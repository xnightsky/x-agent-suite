/**
 * @module @x-agent-suite/harness/tests/pty-watcher
 * PTY idle 等待在 dispose 时立即终止的回归测试。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { HarnessProfile, LlmBackend } from "@x-agent-suite/contracts";
import type { PtyProcess } from "@x-agent-suite/driver";
import { createSecretRedactor } from "@x-agent-suite/llm-fixture";
import {
  createPtyAgentDriver,
  type PtyAgentDriver,
} from "../src/pty-driver.ts";
import { createPtyScreenWatcher } from "../src/pty-watcher.ts";

test("PtyScreenWatcher：dispose 会拒绝进行中的 waitForIdle", async () => {
  let unsubscribed = false;
  const pty = {
    screen: () => "busy",
    cursor: () => ({ x: 0, y: 0 }),
    onScreenChange: () => () => {
      unsubscribed = true;
    },
  } as unknown as PtyProcess;
  const watcher = createPtyScreenWatcher({
    pty,
    screenIdleMs: 60_000,
    ioIdleMs: 60_000,
    hardTimeoutMs: 60_000,
  });
  const waiting = watcher.waitForIdle();
  watcher.dispose();

  await assert.rejects(waiting, /dispose|释放/);
  assert.equal(unsubscribed, true);
});

function makeSecretPtyDriver(
  secret: string,
  idleMs: number,
  timeoutMs: number,
): PtyAgentDriver {
  const wrappedSecret = [...secret].join("\r\n  ");
  const profile: HarnessProfile = {
    name: "generic-pty-redaction",
    command: process.execPath,
    ptyArgs: () => [
      "-e",
      `process.stdout.write(${JSON.stringify(wrappedSecret)}); process.stdin.resume(); setInterval(() => {}, 1000)`,
    ],
    headlessArgs: () => [],
    wire: "openai-chat",
    baseUrlEnv: "",
    stripEnv: [],
    toolName: (_server, tool) => tool,
    writeConfig: async () => {},
    createParser: () => () => null,
    supportsFixture: true,
  };
  const backend: LlmBackend = {
    mode: "fixture",
    redactor: createSecretRedactor([secret]),
    start: async () => ({ baseUrl: "http://127.0.0.1:1", apiKey: "fake" }),
    stop: async () => {},
  };
  return createPtyAgentDriver({
    profile,
    backend,
    injectServer: false,
    commandOverride: { command: process.execPath, argsPrefix: [] },
    echoTimeoutMs: 0,
    screenIdleMs: idleMs,
    ioIdleMs: idleMs,
    promptTimeoutMs: timeoutMs,
  });
}

test("PtyAgentDriver：拆行屏幕与超时异常应用 backend redactor", async () => {
  const secret = "synthetic-pty-secret";
  const driver = makeSecretPtyDriver(secret, 60_000, 50);
  await driver.start();
  try {
    await assert.rejects(driver.inject("round"), (error: unknown) => {
      assert.doesNotMatch(String(error).replace(/\s/g, ""), new RegExp(secret));
      return true;
    });
    assert.doesNotMatch(
      driver.screenTail().replace(/\s/g, ""),
      new RegExp(secret),
    );
    assert.match(driver.screenTail(), /\[REDACTED\]/);
  } finally {
    await driver.close();
  }
});

test("PtyAgentDriver：Observation 中的拆行屏幕应用 backend redactor", async () => {
  const secret = "synthetic-pty-secret";
  const driver = makeSecretPtyDriver(secret, 0, 2_000);
  await driver.start();
  try {
    const observation = await driver.inject("round");
    assert.doesNotMatch(
      JSON.stringify(observation).replace(/\s/g, ""),
      new RegExp(secret),
    );
    assert.match(observation.text, /\[REDACTED\]/);
  } finally {
    await driver.close();
  }
});

test("PtyAgentDriver：idle 硬超时显式拒绝当前轮次", async () => {
  const profile: HarnessProfile = {
    name: "generic-pty",
    command: process.execPath,
    ptyArgs: () => [
      "-e",
      "process.stdin.resume(); setInterval(() => {}, 1000)",
    ],
    headlessArgs: () => [],
    wire: "openai-chat",
    baseUrlEnv: "",
    stripEnv: [],
    toolName: (_server, tool) => tool,
    writeConfig: async () => {},
    createParser: () => () => null,
    supportsFixture: true,
  };
  const backend: LlmBackend = {
    mode: "fixture",
    start: async () => ({ baseUrl: "http://127.0.0.1:1", apiKey: "fake" }),
    stop: async () => {},
  };
  const driver = createPtyAgentDriver({
    profile,
    backend,
    injectServer: false,
    commandOverride: { command: process.execPath, argsPrefix: [] },
    echoTimeoutMs: 0,
    screenIdleMs: 60_000,
    ioIdleMs: 60_000,
    promptTimeoutMs: 50,
  });
  await driver.start();
  try {
    await assert.rejects(driver.inject("timeout-round"), /timeout|超时/i);
  } finally {
    await driver.close();
  }
});
