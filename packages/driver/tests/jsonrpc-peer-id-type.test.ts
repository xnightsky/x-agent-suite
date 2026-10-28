/**
 * @module @x-agent-suite/driver/tests/jsonrpc-peer-id-type
 * JsonRpcPeer id 配对单测：真实子进程跑脚本化假 JSON-RPC 服务端，
 * 验证响应 id 严格按类型与值配对——字符串 "1" / "01" / "1e0" 不能被
 * Number() 归一后命中数值请求 id 1，未知 id 应答继续丢弃。
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
const BEHAVIOR = join(here, "fixtures", "id-type-peer-behavior.ts");

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

test("JsonRpcPeer：字符串 id 应答不得命中数值请求 id", async () => {
  const peer = await createStartedPeer();
  try {
    const result = await peer.request("string-id-decoy", undefined, 5_000);
    assert.equal(result, "CORRECT_NUMERIC_ID");
    const echoed = await peer.request("echo", { next: true }, 5_000);
    assert.deepEqual(echoed, { next: true });
  } finally {
    await peer.close();
  }
});

test("JsonRpcPeer：字符串 id 的错误应答不得拒绝数值请求", async () => {
  const peer = await createStartedPeer();
  try {
    const result = await peer.request(
      "string-id-error-decoy",
      undefined,
      5_000,
    );
    assert.equal(result, "CORRECT_NUMERIC_ID");
  } finally {
    await peer.close();
  }
});
