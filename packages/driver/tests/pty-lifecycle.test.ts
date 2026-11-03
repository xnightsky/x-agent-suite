/**
 * @module @x-agent-suite/driver/tests/pty-lifecycle
 * PtyProcess 生命周期回归：关闭终态、并发 start/close、永久退出观测。
 * 通过 registerHooks 注入 fake node-pty，不依赖真实 PTY 原生模块。
 */
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { PtyProcess } from "../src/pty.ts";

interface FakePtyInstance {
  readonly pid: number;
  readonly writes: string[];
  readonly kills: string[];
  readonly exitInfo: { exitCode: number | null; signal: number | null } | null;
  emitData(data: string): void;
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
    (globalThis as unknown as { __xasFakePtyState?: FakePtyState })
      .__xasFakePtyState ?? { spawnCount: 0, instances: [] }
  );
}

test("PtyProcess：close 后禁止 restart，且不会 spawn", async () => {
  const proc = new PtyProcess({ command: "fake", killGraceMs: 20 });
  await proc.close();
  const before = fakeState().spawnCount;
  await assert.rejects(proc.start(), /已关闭|关闭.*start|restart/i);
  assert.equal(fakeState().spawnCount, before);
  assert.equal(proc.pid, undefined);
});

test("PtyProcess：start 与 close 并发时最终无活动 PTY", async () => {
  const proc = new PtyProcess({ command: "fake", killGraceMs: 20 });
  const starting = proc.start();
  await proc.close();
  await assert.rejects(starting, /已关闭|关闭.*start|取消/i);
  assert.equal(proc.pid, undefined);
  for (const instance of fakeState().instances) {
    assert.ok(
      instance.exitInfo !== null || instance.kills.length > 0,
      "若 start 已完成 spawn，close 必须 kill 并等待退出",
    );
  }
});

test("PtyProcess：永久 onExit 保存 exitCode/signal，write 拒绝已退出进程", async () => {
  const proc = new PtyProcess({ command: "fake", killGraceMs: 20 });
  await proc.start();
  const instance = fakeState().instances.at(-1)!;
  instance.emitExit({ exitCode: 7, signal: 9 });
  assert.deepEqual(await proc.waitForExit(), { exitCode: 7, signal: 9 });
  assert.deepEqual(proc.exitInfo(), { exitCode: 7, signal: 9 });
  assert.throws(() => proc.write("x"), /未运行|已退出|exit/i);
  await proc.close();
  assert.deepEqual(proc.exitInfo(), { exitCode: 7, signal: 9 });
  assert.deepEqual(instance.kills, [], "已退出进程不应再次 kill");
});

test("PtyProcess：并发 start 只允许一个启动单飞", async () => {
  const proc = new PtyProcess({ command: "fake", killGraceMs: 20 });
  try {
    const first = proc.start();
    await assert.rejects(proc.start(), /已关闭或已启动|重复/);
    await first;
  } finally {
    await proc.close().catch(() => undefined);
  }
});
