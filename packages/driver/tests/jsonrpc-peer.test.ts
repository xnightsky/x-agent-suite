/**
 * @module @x-agent-suite/driver/tests/jsonrpc-peer
 * JsonRpcPeer wire 层单测：真实子进程跑脚本化假 JSON-RPC 服务端
 * （tests/fixtures/fake-jsonrpc-peer.ts + demo-peer-behavior.ts，虚构方法名），
 * 覆盖请求配对、通知回调、反向请求应答 / -32601、超时、非法 JSONL、
 * 结束回调抛错时的进程/请求/计时器清理与幂等 close、自然 EOF 后延迟关闭前的拒绝观察，
 * 以及消费终止后（含结束回调重入）请求立即拒绝、不写进程且不创建计时器。
 * 不变量：假 peer 是通用测试子进程、零 token、不起真实宿主，按分层约定归单元测试。
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

for (const { name, output, reason } of [
  {
    name: "非法 JSONL",
    output: "console.log('not-json')",
    reason: /非 JSON 行/,
  },
  { name: "无法路由", output: "console.log('{}')", reason: /无法路由/ },
  { name: "自然 EOF", output: "process.stdout.end()", reason: null },
]) {
  test(`JsonRpcPeer：${name}终止后及结束回调重入的请求立即拒绝且无副作用`, async (t) => {
    const proc = new JsonlProcess({
      command: process.execPath,
      args: [
        "-e",
        `process.stdin.on('data', () => process.stderr.write('REQUEST_SENT_AFTER_FAILURE')); ${output}; setInterval(() => {}, 1000)`,
      ],
      killGraceMs: 100,
    });
    t.after(() => proc.close());
    await proc.start();
    const peer = new JsonRpcPeer({ proc });
    t.after(() => peer.close());
    const send = t.mock.method(proc, "send");
    const schedule = t.mock.method(globalThis, "setTimeout");
    let reentrant: Promise<unknown> | undefined;
    const ended = new Promise<Error | null>((resolve) => {
      peer.onStreamEnd((error) => {
        reentrant = peer
          .request("from-onStreamEnd", undefined, 100)
          .catch((failure: unknown) => failure);
        resolve(error);
      });
    });
    peer.start();
    const failure = await ended;
    if (reason) {
      assert.ok(failure instanceof Error);
      assert.match(failure.message, reason);
    } else {
      assert.equal(failure, null);
    }
    const after = peer
      .request("after-failure", undefined, 100)
      .catch((error: unknown) => error);
    // 只推进拒绝反应的微任务，不等待请求超时或进程 I/O。
    await Promise.resolve();
    for (const request of [reentrant!, after]) {
      const result = await Promise.race([request, Promise.resolve("pending")]);
      assert.ok(result instanceof Error, "终止后的请求必须立即拒绝");
      if (failure) assert.equal(result, failure);
      else assert.match(result.message, /对端流已结束/);
    }
    assert.equal(send.mock.callCount(), 0, "终止后不得写入进程");
    assert.equal(schedule.mock.callCount(), 0, "终止后不得创建请求计时器");
    schedule.mock.restore();
    await peer.close();
    assert.equal(proc.pid, undefined);
    assert.doesNotMatch(proc.stderrTail(), /REQUEST_SENT_AFTER_FAILURE/);
    await assert.rejects(peer.request("after-close"), /已关闭/);
  });
}

test("JsonRpcPeer：自然 EOF 回调抛错不崩溃，延迟 close 仍清理并幂等拒绝原错", () => {
  const source = `
    import assert from 'node:assert/strict';
    import { JsonlProcess } from ${JSON.stringify(new URL("../src/proc.ts", import.meta.url).href)};
    import { JsonRpcPeer } from ${JSON.stringify(new URL("../src/jsonrpc-peer.ts", import.meta.url).href)};
    const proc = new JsonlProcess({ command: process.execPath, args: ['-e', ''] });
    await proc.start();
    try {
      const peer = new JsonRpcPeer({ proc });
      const failure = new Error('callback after natural EOF');
      let endCalls = 0;
      const ended = new Promise((resolve) => {
        peer.onStreamEnd((error) => {
          assert.equal(error, null);
          endCalls++;
          resolve();
          process.stdout.write('ended\\n');
          throw failure;
        });
      });
      peer.start();
      await ended;
      await new Promise((resolve) => setImmediate(resolve));
      await Promise.all([
        assert.rejects(peer.close(), (error) => error === failure),
        assert.rejects(peer.close(), (error) => error === failure),
      ]);
      assert.equal(proc.pid, undefined);
      await assert.rejects(peer.close(), (error) => error === failure);
      assert.equal(endCalls, 1);
      process.stdout.write('closed\\n');
    } finally {
      await proc.close();
    }
  `;
  const args = [
    "--unhandled-rejections=strict",
    "--import",
    import.meta.resolve("tsx/esm"),
    "--input-type=module",
    "-e",
    source,
  ];
  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "ended\nclosed\n");
});

test("JsonRpcPeer：close 幂等，关闭后 request 显式抛错", async () => {
  const peer = await createStartedPeer();
  await peer.close();
  await peer.close();
  await assert.rejects(peer.request("echo", {}, 100), /已关闭/);
});

test("JsonRpcPeer：结束回调抛错时 close 仍清理进程、悬挂请求与计时器，且幂等暴露原错", async (t) => {
  const proc = new JsonlProcess({
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    killGraceMs: 100,
  });
  t.after(() => proc.close());
  await proc.start();
  const pid = proc.pid;
  assert.ok(pid);
  const peer = new JsonRpcPeer({ proc });
  const failure = new Error("consumer callback failed");
  let endCalls = 0;
  peer.onStreamEnd(() => {
    endCalls++;
    throw failure;
  });
  peer.start();
  const schedule = t.mock.method(globalThis, "setTimeout");
  const cancel = t.mock.method(globalThis, "clearTimeout");
  const pending = ["first", "second"].map((method) =>
    peer.request(method, undefined, 60_000).catch((error: unknown) => error),
  );
  const timers = schedule.mock.calls.map((call) => call.result);
  t.after(() => timers.forEach((timer) => clearTimeout(timer)));
  await Promise.all([
    assert.rejects(peer.close(), (error) => error === failure),
    assert.rejects(peer.close(), (error) => error === failure),
  ]);
  assert.equal(proc.pid, undefined);
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  for (const request of pending) {
    const result = await Promise.race([request, Promise.resolve("pending")]);
    assert.ok(result instanceof Error);
    assert.match(result.message, /已关闭/);
  }
  for (const timer of timers) {
    assert.ok(cancel.mock.calls.some((call) => call.arguments[0] === timer));
  }
  await assert.rejects(peer.close(), (error) => error === failure);
  assert.equal(endCalls, 1);
  await assert.rejects(peer.request("after-close"), /已关闭/);
});
