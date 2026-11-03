/**
 * @module @x-agent-suite/driver/tests/long-lived-jsonrpc-lifecycle
 * LongLivedJsonRpcDriver 生命周期回归：close 清理、活动轮次取消、
 * waitInbound predicate 隔离以及 falsy session 值。
 */
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  LongLivedJsonRpcDriver,
  type JsonRpcLongLivedAdapter,
} from "../src/long-lived-jsonrpc.ts";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE_PEER = join(here, "fixtures", "fake-jsonrpc-peer.ts");
const DEMO_BEHAVIOR = join(here, "fixtures", "demo-driver-behavior.ts");
const NEVER_REPLY_BEHAVIOR = join(here, "fixtures", "never-reply-behavior.ts");

function createDemoAdapter(): JsonRpcLongLivedAdapter {
  return {
    async handshake(peer) {
      const result = (await peer.request(
        "handshake",
        { version: 1 },
        2_000,
      )) as { sessionId?: string };
      if (!result.sessionId) throw new Error("handshake missing sessionId");
      return { sessionId: result.sessionId };
    },
    buildPrompt: (session, text) => ({
      method: "turn",
      params: { session, text },
    }),
    mapNotification(msg) {
      if (msg.method !== "event") return { kind: "ignore" };
      const params = (msg.params ?? {}) as { chunk?: string; idle?: boolean };
      if (params.idle) {
        return {
          kind: "inbound",
          event: {
            kind: "notification",
            timestamp: Date.now(),
            payload: msg.params,
          },
        };
      }
      return {
        kind: "round",
        eventType: "chunk",
        payload: msg.params,
        text: params.chunk ?? "",
      };
    },
    closeRequest: (session) => ({ method: "finish", params: { session } }),
  };
}

function createDriver(
  options: {
    readonly adapter?: JsonRpcLongLivedAdapter;
    readonly behavior?: string;
    readonly requestTimeoutMs?: number;
  } = {},
): LongLivedJsonRpcDriver {
  return new LongLivedJsonRpcDriver({
    spawn: {
      command: process.execPath,
      args: ["--import", import.meta.resolve("tsx/esm"), FAKE_PEER],
      env: {
        ...process.env,
        FAKE_JSONRPC_PEER_BEHAVIOR: options.behavior ?? DEMO_BEHAVIOR,
      },
    },
    adapter: options.adapter ?? createDemoAdapter(),
    injectMode: "followUp",
    requestTimeoutMs: options.requestTimeoutMs ?? 2_000,
  });
}

test("LongLived：closeRequest 同步抛错仍关闭 peer/process，并保留清理错误", async () => {
  const adapter = createDemoAdapter();
  const driver = createDriver({
    adapter: {
      ...adapter,
      closeRequest: () => {
        throw new Error("closeRequest boom");
      },
    },
  });
  await driver.start();
  const internal = driver as unknown as {
    proc: { pid?: number; close(): Promise<void> };
    peer: { close(): Promise<void> };
  };
  const pid = internal.proc.pid;
  try {
    await assert.rejects(driver.close(), /closeRequest boom/);
    let alive = false;
    if (pid !== undefined) {
      try {
        process.kill(pid, 0);
        alive = true;
      } catch {
        // 已退出。
      }
    }
    assert.equal(alive, false, "closeRequest 异常不得阻断 peer/process 清理");
  } finally {
    await internal.peer.close().catch(() => undefined);
    await internal.proc.close().catch(() => undefined);
  }
});

test("LongLived：waitInbound predicate 抛错只拒绝该 waiter，不杀整条 wire", async () => {
  const driver = createDriver();
  await driver.start();
  try {
    const goodWaiter = driver.waitInbound(
      (event) =>
        (event.payload as { title?: string }).title === "inbound-arrived",
      1_000,
    );
    const badWaiter = driver.waitInbound(() => {
      throw new Error("PREDICATE_BOOM");
    }, 1_000);
    const first = await driver.inject("notify-later");
    assert.equal(first.text, "echo:notify-later");
    await assert.rejects(badWaiter, /PREDICATE_BOOM/);
    const received = await goodWaiter;
    assert.equal(
      (received.payload as { title?: string }).title,
      "inbound-arrived",
    );
    const second = await driver.inject("after-predicate");
    assert.equal(second.text, "echo:after-predicate");
  } finally {
    await driver.close();
  }
});

for (const session of [0, false, ""] as const) {
  test(`LongLived：falsy session ${JSON.stringify(session)} 仍视为已握手`, async () => {
    let closedSession: unknown = Symbol("not-closed");
    const adapter = createDemoAdapter();
    const driver = createDriver({
      adapter: {
        ...adapter,
        handshake: async () => session,
        closeRequest: (value) => {
          closedSession = value;
          return { method: "finish", params: { value } };
        },
      },
    });
    await driver.start();
    try {
      const observation = await driver.inject("hi");
      assert.equal(observation.text, "echo:hi");
      await driver.close();
      assert.equal(closedSession, session);
    } finally {
      await driver.close().catch(() => undefined);
    }
  });
}

test("LongLived：close 取消在飞轮次，不等待完整 request timeout", async () => {
  let markBuilt!: () => void;
  const built = new Promise<void>((resolve) => {
    markBuilt = resolve;
  });
  const adapter = createDemoAdapter();
  const driver = createDriver({
    behavior: NEVER_REPLY_BEHAVIOR,
    requestTimeoutMs: 2_000,
    adapter: {
      ...adapter,
      buildPrompt: (session, text, mode) => {
        markBuilt();
        return adapter.buildPrompt(session, text, mode);
      },
    },
  });
  await driver.start();
  const injecting = driver.inject("hang").then(
    () => "resolved",
    (error: unknown) => error,
  );
  await built;
  const startedAt = Date.now();
  try {
    await driver.close();
    assert.ok(
      Date.now() - startedAt < 500,
      `close 应取消在飞轮次，实际 ${Date.now() - startedAt}ms`,
    );
    const outcome = await injecting;
    assert.ok(outcome instanceof Error);
  } finally {
    await driver.close().catch(() => undefined);
  }
});
