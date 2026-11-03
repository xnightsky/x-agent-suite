/**
 * @module @x-agent-suite/driver/tests/proc-lifecycle
 * JsonlProcess 生命周期回归：close 后 restart 必须拒绝，start/close 并发可收尾。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { JsonlProcess } from "../src/proc.ts";

function makeProcess(): JsonlProcess {
  return new JsonlProcess({
    command: process.execPath,
    args: ["-e", "process.stdin.resume(); setInterval(() => {}, 1000)"],
    killGraceMs: 50,
  });
}

function killIfNeeded(proc: JsonlProcess): void {
  const pid = proc.pid;
  if (pid !== undefined) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // 已退出。
    }
  }
}

test("JsonlProcess：close 后 start 必须拒绝且不 spawn", async () => {
  const proc = makeProcess();
  try {
    await proc.close();
    await assert.rejects(proc.start(), /已关闭|关闭.*start|restart/i);
    assert.equal(proc.pid, undefined);
  } finally {
    killIfNeeded(proc);
    await proc.close().catch(() => undefined);
  }
});

test("JsonlProcess：start 与 close 并发时最终无活动子进程", async () => {
  const proc = makeProcess();
  try {
    const starting = proc.start();
    await proc.close();
    await assert.rejects(starting, /已关闭|关闭.*start|取消/i);
    assert.equal(proc.pid, undefined);
  } finally {
    killIfNeeded(proc);
    await proc.close().catch(() => undefined);
  }
});

test("JsonlProcess：并发 start 只允许一个启动单飞", async () => {
  const proc = makeProcess();
  try {
    const first = proc.start();
    await assert.rejects(proc.start(), /已关闭或已启动|重复/);
    await first;
  } finally {
    killIfNeeded(proc);
    await proc.close().catch(() => undefined);
  }
});
