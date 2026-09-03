/**
 * @module @x-agent-suite/driver/tests/jsonrpc-peer
 * JsonRpcPeer wire 层单测：真实子进程跑脚本化假 JSON-RPC 服务端
 * （tests/fixtures/fake-jsonrpc-peer.ts + demo-peer-behavior.ts，虚构方法名），
 * 覆盖请求配对、通知回调、反向请求应答 / -32601、超时、非法 JSONL 与幂等 close。
 * 不变量：假 peer 是通用测试子进程、零 token、不起真实宿主，按分层约定归单元测试。
 */
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { JsonRpcPeer } from "../src/jsonrpc-peer.ts";
import { JsonlProcess } from "../src/proc.ts";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE_PEER = join(here, "fixtures", "fake-jsonrpc-peer.ts");
const BEHAVIOR = join(here, "fixtures", "demo-peer-behavior.ts");

/** 拉起假 peer 子进程并构造已 start 的 JsonRpcPeer。 */
async function createStartedPeer(): Promise<JsonRpcPeer> {
  const proc = new JsonlProcess({
    command: process.execPath,
    args: ["--import", import.meta.resolve("tsx/esm"), FAKE_PEER],
    env: { ...process.env, FAKE_JSONRPC_PEER_BEHAVIOR: BEHAVIOR },
  });
  await proc.start();
  const peer = new JsonRpcPeer({ proc });
  peer.start();
  return peer;
}

test("JsonRpcPeer：请求/响应往返（id 配对）", async () => {
  const peer = await createStartedPeer();
  try {
    const result = await peer.request("echo", { hello: "wire" }, 5_000);
    assert.deepEqual(result, { hello: "wire" });
  } finally {
    await peer.close();
  }
});

test("JsonRpcPeer：通知回调按序触发", async () => {
  const peer = await createStartedPeer();
  const seen: unknown[] = [];
  peer.onNotification((msg) => {
    seen.push({ method: msg.method, params: msg.params });
  });
  try {
    const result = await peer.request("trigger-notify", undefined, 5_000);
    assert.deepEqual(result, { sent: true });
    assert.deepEqual(seen, [{ method: "event", params: { seq: 1 } }]);
  } finally {
    await peer.close();
  }
});

test("JsonRpcPeer：反向请求由注册 handler 应答并回传结果", async () => {
  const peer = await createStartedPeer();
  peer.onReverseRequest((msg) => {
    assert.equal(msg.method, "ask");
    return { handled: true, result: { choice: "yes" } };
  });
  try {
    const result = await peer.request("make-reverse", { method: "ask" }, 5_000);
    assert.deepEqual(result, { answer: { choice: "yes" } });
  } finally {
    await peer.close();
  }
});

test("JsonRpcPeer：未注册的反向请求回 -32601 防止对端挂起", async () => {
  const peer = await createStartedPeer();
  peer.onReverseRequest(() => ({ handled: false }));
  try {
    const result = (await peer.request(
      "make-reverse",
      { method: "unknown-reverse" },
      5_000,
    )) as { error: string };
    assert.match(result.error, /-32601/);
    assert.match(result.error, /unknown-reverse/);
  } finally {
    await peer.close();
  }
});

test("JsonRpcPeer：请求超时显式拒绝并附 stderr 诊断", async () => {
  const peer = await createStartedPeer();
  try {
    await assert.rejects(
      peer.request("never-reply", undefined, 200),
      /请求 never-reply 超时（200ms）/,
    );
  } finally {
    await peer.close();
  }
});

test("JsonRpcPeer：对端输出非法 JSONL 时悬挂请求显式失败，close 仍能清理干净", async () => {
  const peer = await createStartedPeer();
  await assert.rejects(peer.request("broken", undefined, 5_000), /非 JSON 行/);
  await assert.doesNotReject(peer.close());
  await assert.doesNotReject(peer.close());
});

test("JsonRpcPeer：无悬挂请求时自然流结束属正常结束", async () => {
  const proc = new JsonlProcess({
    command: process.execPath,
    args: ["-e", ""],
  });
  await proc.start();
  const peer = new JsonRpcPeer({ proc });
  const ended = new Promise<Error | null>((resolve) => {
    peer.onStreamEnd(resolve);
  });
  peer.start();
  assert.equal(await ended, null);
  await assert.doesNotReject(peer.close());
});

test("JsonRpcPeer：close 幂等，关闭后 request 显式抛错", async () => {
  const peer = await createStartedPeer();
  await peer.close();
  await peer.close();
  await assert.rejects(peer.request("echo", {}, 100), /已关闭/);
});
