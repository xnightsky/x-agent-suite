/**
 * @module @x-agent-suite/driver/tests/long-lived-jsonrpc
 * LongLivedJsonRpcDriver 骨架单测：假 peer 子进程（demo-driver-behavior.ts，
 * 虚构方法名）+ 演示 adapter，覆盖握手、多轮 inject、反向请求、轮次内聚合、
 * 轮次外 inbound / waitInbound、幂等 close 与非法 JSONL 清理。
 * 不变量：假 peer 是通用测试子进程、零 token、不起真实宿主，按分层约定归单元测试。
 */
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  LongLivedJsonRpcDriver,
  type JsonRpcLongLivedAdapter,
  type NotificationMapping,
} from "../src/long-lived-jsonrpc.ts";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE_PEER = join(here, "fixtures", "fake-jsonrpc-peer.ts");
const BEHAVIOR = join(here, "fixtures", "demo-driver-behavior.ts");

/** 演示 adapter：handshake 提取会话句柄，turn 轮次，event 通知归一。 */
function createDemoAdapter(): JsonRpcLongLivedAdapter {
  return {
    async handshake(peer) {
      const result = (await peer.request(
        "handshake",
        { version: 1 },
        5_000,
      )) as {
        sessionId?: string;
      };
      if (!result.sessionId) {
        throw new Error(`握手响应缺 sessionId: ${JSON.stringify(result)}`);
      }
      return { sessionId: result.sessionId };
    },
    buildPrompt: (session, text) => ({
      method: "turn",
      params: { session, text },
    }),
    answerReverseRequest: (msg) =>
      msg.method === "ask"
        ? { handled: true, result: { ok: true } }
        : { handled: false },
    mapNotification(msg): NotificationMapping {
      if (msg.method !== "event") {
        return { kind: "ignore" };
      }
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

/** 用假 peer 子进程构造 driver（不起真实宿主）。 */
function createDriver(): LongLivedJsonRpcDriver {
  return new LongLivedJsonRpcDriver({
    spawn: {
      command: process.execPath,
      args: ["--import", import.meta.resolve("tsx/esm"), FAKE_PEER],
      env: { ...process.env, FAKE_JSONRPC_PEER_BEHAVIOR: BEHAVIOR },
    },
    adapter: createDemoAdapter(),
    injectMode: "followUp",
    requestTimeoutMs: 5_000,
  });
}

test("LongLivedJsonRpcDriver：握手 + 多轮 inject 会话保持存活", async () => {
  const driver = createDriver();
  await driver.start();
  try {
    assert.equal(driver.injectMode, "followUp");
    const first = await driver.sendPrompt("hi");
    assert.equal(first.text, "echo:hi");
    assert.equal(first.toolCallsCount, 0);
    assert.deepEqual(
      first.events.map((e) => e.type),
      ["chunk", "prompt_result"],
    );
    const second = await driver.inject("第二轮");
    assert.equal(second.text, "echo:第二轮");
    const third = await driver.inject("第三轮");
    assert.equal(third.text, "echo:第三轮");
  } finally {
    await driver.close();
  }
});

test("LongLivedJsonRpcDriver：轮次内反向请求经 adapter 应答后归当轮", async () => {
  const driver = createDriver();
  await driver.start();
  try {
    const obs = await driver.inject("reverse");
    assert.equal(obs.text, 'answered:{"ok":true}');
  } finally {
    await driver.close();
  }
});

test("LongLivedJsonRpcDriver：轮次外通知进 inbound，waitInbound 命中且按序", async () => {
  const driver = createDriver();
  await driver.start();
  const seen: string[] = [];
  const consumer = (async () => {
    for await (const event of driver.inbound()) {
      seen.push(String((event.payload as { title?: string }).title ?? ""));
    }
  })();
  try {
    const obs = await driver.inject("notify-later");
    assert.equal(obs.text, "echo:notify-later");
    const event = await driver.waitInbound(
      (e) => e.kind === "notification",
      5_000,
    );
    assert.equal(
      (event.payload as { title?: string }).title,
      "inbound-arrived",
    );
    assert.ok(event.timestamp > 0);
  } finally {
    await driver.close();
  }
  await consumer;
  assert.deepEqual(seen, ["inbound-arrived"]);
});

test("LongLivedJsonRpcDriver：waitInbound 超时显式抛错", async () => {
  const driver = createDriver();
  await driver.start();
  try {
    await assert.rejects(
      driver.waitInbound(() => false, 200),
      /waitInbound 超时/,
    );
  } finally {
    await driver.close();
  }
});

test("LongLivedJsonRpcDriver：close 幂等，关闭后 inject/sendPrompt 显式抛错", async () => {
  const driver = createDriver();
  await driver.start();
  await driver.sendPrompt("hi");
  await driver.close();
  await driver.close();
  await assert.rejects(driver.inject("again"), /已关闭/);
  await assert.rejects(driver.sendPrompt("again"), /已关闭/);
  await assert.rejects(
    driver.waitInbound(() => true, 100),
    /已关闭/,
  );
});

test("LongLivedJsonRpcDriver：对端输出非法 JSONL 时悬挂请求显式失败，close 仍能清理干净", async () => {
  const driver = createDriver();
  await driver.start();
  await assert.rejects(driver.inject("broken"), /非 JSON 行/);
  await assert.doesNotReject(driver.close());
});
