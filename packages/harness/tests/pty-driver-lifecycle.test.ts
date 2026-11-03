/**
 * @module @x-agent-suite/harness/tests/pty-driver-lifecycle
 * PTY driver 退出观测回归：ready 前退出与轮次中退出都不得产出 Observation。
 * 使用 fake PTY 模块，不依赖本机原生 PTY。
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import type { HarnessProfile, LlmBackend } from "@x-agent-suite/contracts";
import { PtyProcess } from "@x-agent-suite/driver";
import type { FsChangeWatcher } from "../src/pty-watcher.ts";
import { createPtyAgentDriver } from "../src/pty-driver.ts";

interface FakePtyInstance {
  readonly writes: string[];
  readonly exitInfo: { exitCode: number | null; signal: number | null } | null;
  emitExit(info: { exitCode?: number | null; signal?: number | null }): void;
}

interface FakePtyState {
  spawnCount: number;
  instances: FakePtyInstance[];
}

const fakeModuleUrl = new URL("./fixtures/fake-pty-module.mjs", import.meta.url)
  .href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "node-pty") {
      return { url: fakeModuleUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

function fakeState(): FakePtyState {
  return (
    (
      globalThis as unknown as {
        __xasHarnessFakePtyState?: FakePtyState;
      }
    ).__xasHarnessFakePtyState ?? { spawnCount: 0, instances: [] }
  );
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(5);
  }
  throw new Error("waitFor timeout");
}

const backend: LlmBackend = {
  mode: "fixture",
  start: async () => ({ baseUrl: "http://127.0.0.1:1", apiKey: "fake" }),
  stop: async () => {},
};

const profile: HarnessProfile = {
  name: "fake-pty-exit",
  command: "fake-pty",
  ptyArgs: () => [],
  ptyReadyPattern: /READY/,
  headlessArgs: () => [],
  wire: "openai-chat",
  baseUrlEnv: "",
  stripEnv: [],
  toolName: (_server, tool) => tool,
  writeConfig: async () => {},
  createParser: () => () => null,
  supportsFixture: true,
};

function makeDriver(
  overrides: {
    readonly profile?: HarnessProfile;
    readonly backend?: LlmBackend;
    readonly fsWatcher?: FsChangeWatcher;
    readonly echoTimeoutMs?: number;
    readonly startSettleTimeoutMs?: number;
  } = {},
) {
  return createPtyAgentDriver({
    profile: overrides.profile ?? profile,
    backend: overrides.backend ?? backend,
    injectServer: false,
    commandOverride: { command: "fake-pty", argsPrefix: [] },
    readyTimeoutMs: 500,
    echoTimeoutMs: overrides.echoTimeoutMs ?? 50,
    screenIdleMs: 0,
    ioIdleMs: 0,
    promptTimeoutMs: 1_000,
    ...(overrides.fsWatcher ? { fsWatcher: overrides.fsWatcher } : {}),
    ...(overrides.startSettleTimeoutMs !== undefined
      ? { startSettleTimeoutMs: overrides.startSettleTimeoutMs }
      : {}),
  });
}

test("PtyAgentDriver：ready 前异常退出快速失败并清理 sandbox", async () => {
  process.env.XAS_FAKE_PTY_MODE = "silent";
  const driver = makeDriver();
  try {
    const starting = driver.start().then(
      () => "resolved",
      (error: unknown) => error,
    );
    await waitFor(() => fakeState().instances.length > 0);
    fakeState().instances.at(-1)!.emitExit({ exitCode: 9, signal: null });
    const outcome = await Promise.race([
      starting,
      delay(300).then(() => "pending" as const),
    ]);
    assert.ok(
      outcome instanceof Error,
      `start 应失败，实际：${String(outcome)}`,
    );
    assert.match(outcome.message, /\[driver-env\].*exitCode=9/);
    assert.equal(existsSync(driver.sandbox.homeDir), false);
  } finally {
    delete process.env.XAS_FAKE_PTY_MODE;
    await driver.close().catch(() => undefined);
  }
});

test("PtyAgentDriver：轮次中异常退出立即拒绝且不返回 Observation", async () => {
  process.env.XAS_FAKE_PTY_MODE = "ready";
  const driver = makeDriver();
  await driver.start();
  try {
    const instance = fakeState().instances.at(-1)!;
    const internal = driver as unknown as {
      readonly activePtyExitWaiters: Set<unknown>;
    };
    const injecting = driver.inject("hello").then(
      () => "resolved",
      (error: unknown) => error,
    );
    await waitFor(() => instance.writes.includes("hello"));
    assert.equal(
      internal.activePtyExitWaiters.size,
      1,
      "进行中的操作应注册且仅注册一个 active exit waiter",
    );
    instance.emitExit({ exitCode: 5, signal: null });
    const outcome = await Promise.race([
      injecting,
      delay(300).then(() => "pending" as const),
    ]);
    assert.ok(
      outcome instanceof Error,
      `inject 应失败，实际：${String(outcome)}`,
    );
    assert.match(outcome.message, /\[driver-env\].*exitCode=5/);
    assert.equal(
      internal.activePtyExitWaiters.size,
      0,
      "退出后 active waiter 必须清空",
    );
  } finally {
    await driver.close().catch(() => undefined);
  }
});

test("PtyAgentDriver：close-before-start 后 start 拒绝且不 spawn", async () => {
  const before = fakeState().spawnCount;
  const driver = makeDriver();
  await driver.close("close before start");
  await assert.rejects(driver.start(), /重复 start|已关闭|closed/i);
  assert.equal(fakeState().spawnCount, before, "close 后不得拉起 PTY");
});

test("PtyAgentDriver：close-during-start 等待 start settle、清理 sandbox 且不 spawn", async () => {
  let configEntered!: () => void;
  const configReady = new Promise<void>((resolve) => {
    configEntered = resolve;
  });
  let releaseConfig!: () => void;
  const configGate = new Promise<void>((resolve) => {
    releaseConfig = resolve;
  });
  let backendStops = 0;
  const slowConfigProfile: HarnessProfile = {
    ...profile,
    async writeConfig() {
      configEntered();
      await configGate;
    },
  };
  const trackedBackend: LlmBackend = {
    mode: "fixture",
    start: async () => ({ baseUrl: "http://127.0.0.1:1", apiKey: "fake" }),
    stop: async () => {
      backendStops += 1;
    },
  };
  const before = fakeState().spawnCount;
  const driver = makeDriver({
    profile: slowConfigProfile,
    backend: trackedBackend,
  });
  const starting = driver.start().then(
    () => "resolved",
    (error: unknown) => error,
  );
  await configReady;
  const closing = driver.close("close during start");
  releaseConfig();

  const startOutcome = await Promise.race([
    starting,
    delay(1_000).then(() => "pending" as const),
  ]);
  assert.ok(
    startOutcome instanceof Error,
    `close-during-start 后 start 必须失败，实际：${String(startOutcome)}`,
  );
  assert.match(startOutcome.message, /close|关闭|取消/i);
  await closing;
  assert.equal(backendStops, 1);
  assert.equal(fakeState().spawnCount, before, "close 后 start 不得继续 spawn");
  assert.equal(driver.screenSource(), null);
  assert.equal(existsSync(driver.sandbox.homeDir), false);
});

test("PtyAgentDriver：start-while-closing 立即拒绝且不创建资源", async () => {
  let releaseStop!: () => void;
  const stopGate = new Promise<void>((resolve) => {
    releaseStop = resolve;
  });
  let stopEntered!: () => void;
  const entered = new Promise<void>((resolve) => {
    stopEntered = resolve;
  });
  const slowStopBackend: LlmBackend = {
    mode: "fixture",
    start: async () => ({ baseUrl: "http://127.0.0.1:1", apiKey: "fake" }),
    stop: async () => {
      stopEntered();
      await stopGate;
    },
  };
  const before = fakeState().spawnCount;
  const driver = makeDriver({ backend: slowStopBackend });
  const closing = driver.close("start while closing");
  await entered;
  await assert.rejects(driver.start(), /重复 start|已关闭|closing|closed/i);
  releaseStop();
  await closing;
  assert.equal(fakeState().spawnCount, before);
});

test("PtyAgentDriver：close 与 idle 完成交错时不得返回成功 Observation", async () => {
  let driver!: ReturnType<typeof makeDriver>;
  let closeQueued = false;
  const fsWatcher: FsChangeWatcher = {
    lastChangedAt: () => {
      const writes = fakeState().instances.at(-1)?.writes ?? [];
      if (!closeQueued && writes.includes("idle-interleave")) {
        closeQueued = true;
        queueMicrotask(() => {
          void driver.close("idle close interleave");
        });
      }
      return undefined;
    },
  };
  driver = makeDriver({ fsWatcher, echoTimeoutMs: 0 });
  await driver.start();
  try {
    const outcome = await Promise.race([
      driver.inject("idle-interleave").then(
        () => ({ kind: "resolved" as const }),
        (error: unknown) => ({ kind: "rejected" as const, error }),
      ),
      delay(2_000).then(() => ({ kind: "pending" as const })),
    ]);
    assert.equal(
      outcome.kind,
      "rejected",
      "idle 与 close 交错时不得返回成功 Observation",
    );
    if (outcome.kind === "rejected") {
      assert.match(String(outcome.error), /close|关闭|取消/i);
    }
  } finally {
    await driver.close().catch(() => undefined);
  }
});

test("PtyAgentDriver：并发 start 只允许一个启动单飞", async () => {
  let releaseStart!: () => void;
  const startGate = new Promise<void>((resolve) => {
    releaseStart = resolve;
  });
  let starts = 0;
  const gatedBackend: LlmBackend = {
    mode: "fixture",
    start: async () => {
      starts += 1;
      await startGate;
      return { baseUrl: "http://127.0.0.1:1", apiKey: "fake" };
    },
    stop: async () => {},
  };
  const driver = makeDriver({ backend: gatedBackend });
  const first = driver.start();
  await waitFor(() => starts === 1);
  await assert.rejects(driver.start(), /重复 start|starting|已启动/);
  releaseStart();
  await first;
  await driver.close();
  assert.equal(starts, 1, "并发 start 不得重复启动 backend");
});

test("PtyAgentDriver：普通 start 失败仍聚合 cleanup 错误且清理 sandbox", async () => {
  const failingProfile: HarnessProfile = {
    ...profile,
    writeConfig: async () => {
      throw new Error("PRIMARY_START_BOOM");
    },
  };
  const failingCleanupBackend: LlmBackend = {
    mode: "fixture",
    start: async () => ({ baseUrl: "http://127.0.0.1:1", apiKey: "fake" }),
    stop: async () => {
      throw new Error("CLEANUP_STOP_BOOM");
    },
  };
  const driver = makeDriver({
    profile: failingProfile,
    backend: failingCleanupBackend,
  });
  await assert.rejects(driver.start(), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /PRIMARY_START_BOOM/);
    assert.match(error.message, /CLEANUP_STOP_BOOM/);
    return true;
  });
  assert.equal(
    existsSync(driver.sandbox.homeDir),
    false,
    "cleanup 失败仍必须删除 sandbox",
  );
});

test("PtyAgentDriver：close 期间与 close 后 inject 均立即拒绝", async () => {
  const driver = makeDriver();
  await driver.start();
  const closing = driver.close("inject guard");
  await assert.rejects(driver.inject("during-close"), /已关闭/);
  await closing;
  await assert.rejects(driver.inject("after-close"), /已关闭/);
  assert.equal(driver.screenSource(), null);
});

test("PtyAgentDriver：exit 观察单永久订阅，大量 race 完成后 active waiter 归零", async () => {
  const originalWaitForExit = PtyProcess.prototype.waitForExit;
  let waitForExitCalls = 0;
  PtyProcess.prototype.waitForExit = function (this: PtyProcess) {
    waitForExitCalls += 1;
    return originalWaitForExit.call(this);
  };
  const driver = makeDriver();
  try {
    await driver.start();
    const internal = driver as unknown as {
      readonly activePtyExitWaiters: Set<unknown>;
      raceWithPtyExit<T>(
        stage: string,
        run: (signal: AbortSignal) => Promise<T>,
      ): Promise<T>;
    };
    assert.equal(waitForExitCalls, 1, "start 后只能挂接一次永久退出观察");
    for (let index = 0; index < 500; index += 1) {
      const value = await internal.raceWithPtyExit(
        `mass-complete-${index}`,
        async () => index,
      );
      assert.equal(value, index);
    }
    assert.equal(
      waitForExitCalls,
      1,
      "已完成的 race 不得在 pty.waitForExit 上追加 then 订阅",
    );
    assert.equal(
      internal.activePtyExitWaiters.size,
      0,
      "大量完成操作后 active exit waiters 必须归零",
    );

    fakeState().instances.at(-1)!.emitExit({ exitCode: 3, signal: null });
    await delay(0);
    assert.equal(
      internal.activePtyExitWaiters.size,
      0,
      "退出不得触发已完成 waiter 的错误回调或重新驻留",
    );
  } finally {
    PtyProcess.prototype.waitForExit = originalWaitForExit;
    await driver.close().catch(() => undefined);
  }
});

test("PtyAgentDriver：backend.start 永不 settle 时 close 有界返回并停止 backend", async () => {
  let startCalls = 0;
  let stopCalls = 0;
  const hangingBackend: LlmBackend = {
    mode: "fixture",
    start: () => {
      startCalls += 1;
      return new Promise(() => {});
    },
    stop: async () => {
      stopCalls += 1;
    },
  };
  const before = fakeState().spawnCount;
  const driver = makeDriver({
    backend: hangingBackend,
    startSettleTimeoutMs: 20,
  });
  const starting = driver.start().then(
    () => "resolved",
    (error: unknown) => error,
  );
  await waitFor(() => startCalls === 1);
  const startedAt = Date.now();
  const closeOutcome = await Promise.race([
    driver.close("hanging backend").then(
      () => ({ kind: "resolved" as const }),
      (error: unknown) => ({ kind: "rejected" as const, error }),
    ),
    delay(300).then(() => ({ kind: "pending" as const })),
  ]);
  assert.equal(closeOutcome.kind, "resolved");
  assert.ok(Date.now() - startedAt < 300, "close 必须在有界时间内返回");
  assert.ok(stopCalls >= 1, "close 必须停止 pending backend");
  const startOutcome = await Promise.race([
    starting,
    delay(200).then(() => "pending" as const),
  ]);
  assert.ok(startOutcome instanceof Error, "close 必须取消 pending start");
  assert.equal(fakeState().spawnCount, before);
});

test("PtyAgentDriver：backend.start 迟到 resolve 后仍 stop 且不创建 sandbox/PTY", async () => {
  let resolveStart!: (value: { baseUrl: string; apiKey: string }) => void;
  let startCalls = 0;
  let stopCalls = 0;
  const lateBackend: LlmBackend = {
    mode: "fixture",
    start: () => {
      startCalls += 1;
      return new Promise((resolve) => {
        resolveStart = resolve;
      });
    },
    stop: async () => {
      stopCalls += 1;
    },
  };
  const before = fakeState().spawnCount;
  const driver = makeDriver({
    backend: lateBackend,
    startSettleTimeoutMs: 20,
  });
  const starting = driver.start().then(
    () => "resolved",
    (error: unknown) => error,
  );
  try {
    await waitFor(() => startCalls === 1);
    const closeOutcome = await Promise.race([
      driver.close("late backend start").then(
        () => ({ kind: "resolved" as const }),
        (error: unknown) => ({ kind: "rejected" as const, error }),
      ),
      delay(300).then(() => ({ kind: "pending" as const })),
    ]);
    assert.equal(closeOutcome.kind, "resolved");
    const stopsAfterClose = stopCalls;
    resolveStart({ baseUrl: "http://127.0.0.1:1", apiKey: "fake" });
    await waitFor(() => stopCalls > stopsAfterClose);
    await delay(20);
    assert.equal(
      fakeState().spawnCount,
      before,
      "迟到 backend start 不得继续拉起 PTY",
    );
    assert.throws(() => driver.sandbox, /start 之前/);
    const startOutcome = await starting;
    assert.ok(startOutcome instanceof Error);
  } finally {
    resolveStart?.({ baseUrl: "http://127.0.0.1:1", apiKey: "fake" });
    await driver.close().catch(() => undefined);
  }
});

test("PtyAgentDriver：writeConfig 永不 settle 时 close 有界返回并清理 sandbox", async () => {
  let configEntered!: () => void;
  const entered = new Promise<void>((resolve) => {
    configEntered = resolve;
  });
  let stopCalls = 0;
  const hangingConfigProfile: HarnessProfile = {
    ...profile,
    writeConfig: () => {
      configEntered();
      return new Promise(() => {});
    },
  };
  const trackedBackend: LlmBackend = {
    mode: "fixture",
    start: async () => ({ baseUrl: "http://127.0.0.1:1", apiKey: "fake" }),
    stop: async () => {
      stopCalls += 1;
    },
  };
  const driver = makeDriver({
    profile: hangingConfigProfile,
    backend: trackedBackend,
    startSettleTimeoutMs: 20,
  });
  const starting = driver.start().then(
    () => "resolved",
    (error: unknown) => error,
  );
  await entered;
  const startedAt = Date.now();
  const closeOutcome = await Promise.race([
    driver.close("hanging writeConfig").then(
      () => ({ kind: "resolved" as const }),
      (error: unknown) => ({ kind: "rejected" as const, error }),
    ),
    delay(300).then(() => ({ kind: "pending" as const })),
  ]);
  assert.equal(closeOutcome.kind, "resolved");
  assert.ok(Date.now() - startedAt < 300);
  assert.ok(stopCalls >= 1);
  assert.equal(existsSync(driver.sandbox.homeDir), false);
  const startOutcome = await Promise.race([
    starting,
    delay(200).then(() => "pending" as const),
  ]);
  assert.ok(startOutcome instanceof Error);
});

test("PtyAgentDriver：不 settle 的内部 startPromise 也会被 close 有界绕过", async () => {
  let stopCalls = 0;
  const trackedBackend: LlmBackend = {
    mode: "fixture",
    start: async () => ({ baseUrl: "http://127.0.0.1:1", apiKey: "fake" }),
    stop: async () => {
      stopCalls += 1;
    },
  };
  const driver = makeDriver({
    backend: trackedBackend,
    startSettleTimeoutMs: 20,
  });
  const internal = driver as unknown as {
    startPromise: Promise<void> | null;
  };
  internal.startPromise = new Promise(() => {});
  const startedAt = Date.now();
  await driver.close("forced bounded start wait");
  assert.ok(
    Date.now() - startedAt < 300,
    "close 不能被 pending startPromise 永久阻塞",
  );
  assert.ok(stopCalls >= 1, "超时后仍必须执行 cleanup");
  await assert.rejects(driver.start(), /重复 start|已关闭|closed/i);
});
