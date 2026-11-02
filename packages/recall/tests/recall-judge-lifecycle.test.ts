/**
 * @module @x-agent-suite/recall/tests/recall-judge-lifecycle
 * Recall 私有 Judge client 的异步创建、取消、迟到 Driver 与 finally 清理。
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { AgentDriver, Observation } from "@x-agent-suite/contracts";
import { JudgeModelError } from "@x-agent-suite/judge";
import type { RecallResolvedExecution } from "../src/execution.ts";
import { createRecallJudgeModelClient } from "../src/judge-driver.ts";
import type {
  RecallExecutionProfile,
  RecallProfileDriverContext,
  RecallRegistry,
} from "../src/registry.ts";

interface Gate {
  readonly promise: Promise<void>;
  readonly open: () => void;
}

function gate(): Gate {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

async function flushAsync(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function observation(): Observation {
  return { text: '{"ok":true}', toolCalls: [], toolCallsCount: 0, events: [] };
}

function gatedDriver(
  log: string[],
  startGate?: Gate,
  sendGate?: Gate,
  closeFails = false,
): AgentDriver {
  return {
    async start() {
      log.push("start");
      await startGate?.promise;
    },
    async sendPrompt() {
      log.push("send");
      await sendGate?.promise;
      return observation();
    },
    async *events() {},
    async close() {
      log.push("close");
      if (closeFails) throw new Error("close failed");
    },
  };
}

function clientFor(createDriver: RecallExecutionProfile["createDriver"]) {
  const profile: RecallExecutionProfile = { carrier: "carrier", createDriver };
  const execution: RecallResolvedExecution = {
    target: {
      carrier: "carrier",
      channel: {
        wire: "openai-chat",
        baseUrl: "https://fixture.invalid/v1",
        model: "model-a",
        provider: "provider-a",
      },
    },
    mode: "borrowed",
    cliRef: "cli-a",
    profile,
  };
  const registry: RecallRegistry = {
    criteria: [],
    profiles: { "cli-a": profile },
    effectsProfiles: {},
  };
  return createRecallJudgeModelClient({
    execution,
    registry,
    config: { env: {} },
  });
}

function abortError(error: unknown): boolean {
  return error instanceof JudgeModelError && error.kind === "transport";
}

test("同步/异步 profile 均使用独立单轮空权限会话，每 attempt 新 Driver 并 close", async () => {
  for (const asynchronous of [false, true]) {
    const contexts: RecallProfileDriverContext[] = [];
    const drivers: AgentDriver[] = [];
    const log: string[] = [];
    const client = clientFor((context) => {
      log.push("factory");
      contexts.push(context);
      const driver = gatedDriver(log);
      drivers.push(driver);
      return asynchronous ? Promise.resolve(driver) : driver;
    });
    assert.equal(contexts.length, 0, "client 装配不得创建资源");
    for (const prompt of ["judge-one", "judge-two"]) {
      const response = await client.complete({
        prompt,
        signal: new AbortController().signal,
      });
      assert.equal(response.text, '{"ok":true}');
    }
    assert.equal(contexts.length, 2);
    assert.notEqual(drivers[0], drivers[1]);
    assert.notEqual(contexts[0]!.backend, contexts[1]!.backend);
    for (const [index, context] of contexts.entries()) {
      assert.deepEqual(context.spec.turns, [
        { send: "judge-" + (index === 0 ? "one" : "two") },
      ]);
      assert.equal(context.spec.provision, undefined);
      assert.deepEqual(context.executionParams, {});
      assert.equal(context.effects.attribution, "none");
      assert.equal(context.effects.tools, "none");
      assert.equal(context.cliRef, "cli-a");
    }
    assert.deepEqual(log, [
      "factory",
      "start",
      "send",
      "close",
      "factory",
      "start",
      "send",
      "close",
    ]);
  }
});

test("预先 abort 不触达 factory/start/send", async () => {
  let calls = 0;
  const client = clientFor(() => {
    calls += 1;
    return gatedDriver([]);
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    client.complete({ prompt: "judge", signal: controller.signal }),
    abortError,
  );
  assert.equal(calls, 0);
});

test("factory 挂起时 abort 立即失败，迟到 Driver 只 close", async () => {
  const log: string[] = [];
  const factoryGate = gate();
  const client = clientFor(async () => {
    log.push("factory");
    await factoryGate.promise;
    return gatedDriver(log);
  });
  const controller = new AbortController();
  const attempt = client.complete({
    prompt: "judge",
    signal: controller.signal,
  });
  let failure: unknown;
  void attempt.catch((error: unknown) => {
    failure = error;
  });
  await flushAsync();
  controller.abort();
  await flushAsync();
  const earlyFailure = failure;
  factoryGate.open();
  await attempt.catch(() => {});
  await flushAsync();
  assert.ok(abortError(earlyFailure), "取消应立即可见，而非等待 factory");
  assert.deepEqual(log, ["factory", "close"]);
});

test("start 挂起时 abort 仍 close，start 完成后不得 send", async () => {
  const log: string[] = [];
  const startGate = gate();
  const client = clientFor(() => {
    log.push("factory");
    return gatedDriver(log, startGate);
  });
  const controller = new AbortController();
  const attempt = client.complete({
    prompt: "judge",
    signal: controller.signal,
  });
  let failure: unknown;
  void attempt.catch((error: unknown) => {
    failure = error;
  });
  await flushAsync();
  controller.abort();
  await flushAsync();
  const earlyFailure = failure;
  startGate.open();
  await attempt.catch(() => {});
  await flushAsync();
  assert.ok(abortError(earlyFailure), "start 取消不得等待 gate 开放");
  assert.deepEqual(log, ["factory", "start", "close"]);
});

test("send 挂起时 abort 仍 close 且不二次关闭", async () => {
  const log: string[] = [];
  const sendGate = gate();
  const client = clientFor(() => {
    log.push("factory");
    return gatedDriver(log, undefined, sendGate);
  });
  const controller = new AbortController();
  const attempt = client.complete({
    prompt: "judge",
    signal: controller.signal,
  });
  let failure: unknown;
  void attempt.catch((error: unknown) => {
    failure = error;
  });
  await flushAsync();
  controller.abort();
  await flushAsync();
  const earlyFailure = failure;
  sendGate.open();
  await attempt.catch(() => {});
  await flushAsync();
  assert.ok(abortError(earlyFailure), "send 取消不得等待 gate 开放");
  assert.deepEqual(log, ["factory", "start", "send", "close"]);
});

test("close 失败显式归类 cleanup", async () => {
  const client = clientFor(() => gatedDriver([], undefined, undefined, true));
  await assert.rejects(
    client.complete({ prompt: "judge", signal: new AbortController().signal }),
    (error: unknown) =>
      error instanceof JudgeModelError && error.kind === "cleanup",
  );
});
