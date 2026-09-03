/**
 * @module @x-agent-suite/driver/tests/proc
 * JsonlProcess 分帧回归：真实子进程输出含 U+2028 / U+2029 的 JSON 行不得被误切分。
 * 不变量：node:readline 会在 U+2028 断行（已知缺陷），修复后必须整行解析成功。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { JsonlProcess } from "../src/proc.ts";

async function waitForStderrTail(
  proc: JsonlProcess,
  suffix: string,
  timeoutMs = 2_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tail = proc.stderrTail();
    if (tail.endsWith(suffix)) return tail;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`等待 stderr 尾标记超时：${suffix}`);
}

test("JsonlProcess：含 U+2028 / U+2029 的 JSON 行整行解析", async () => {
  const proc = new JsonlProcess({
    command: process.execPath,
    args: [
      "-e",
      "process.stdout.write(JSON.stringify({text:'a\\u2028b\\u2029c'}) + '\\n')",
    ],
  });
  await proc.start();
  try {
    const lines: unknown[] = [];
    for await (const line of proc.lines()) {
      lines.push(line);
    }
    assert.equal(lines.length, 1);
    assert.equal((lines[0] as { text: string }).text, "a\u2028b\u2029c");
  } finally {
    await proc.close();
  }
});

test("JsonlProcess：\\r\\n 行尾容忍", async () => {
  const proc = new JsonlProcess({
    command: process.execPath,
    args: ["-e", 'process.stdout.write(\'{"a":1}\\r\\n{"b":2}\\r\\n\')'],
  });
  await proc.start();
  try {
    const lines: unknown[] = [];
    for await (const line of proc.lines()) {
      lines.push(line);
    }
    assert.deepEqual(lines, [{ a: 1 }, { b: 2 }]);
  } finally {
    await proc.close();
  }
});

test("JsonlProcess: stderr 环形缓冲按行丢弃旧内容（不依赖 data chunk 边界）", async () => {
  const proc = new JsonlProcess({
    command: process.execPath,
    args: [
      "-e",
      "process.stderr.write('chunk-0\\nchunk-1\\nchunk-2\\nchunk-3\\nchunk-4\\n'); setTimeout(() => {}, 1000);",
    ],
    stderrRingLines: 2,
  });
  await proc.start();
  await new Promise((resolve) => setTimeout(resolve, 100));
  await proc.close();
  const tail = proc.stderrTail();
  assert.ok(!tail.includes("chunk-0"), "最旧 chunk 应被丢弃");
  assert.ok(!tail.includes("chunk-1"), "次旧 chunk 应被丢弃");
  assert.ok(!tail.includes("chunk-2"), "第三旧 chunk 应被丢弃");
  assert.ok(
    tail.includes("chunk-3") || tail.includes("chunk-4"),
    "最新 chunk 应保留",
  );
});

test("JsonlProcess: 无 LF stderrPending 有 64KiB 上限并保留 UTF-8 尾部", async () => {
  const proc = new JsonlProcess({
    command: process.execPath,
    args: [
      "-e",
      "process.stderr.write('🙂'.repeat(300000) + 'DIAGNOSTIC_TAIL'); setTimeout(() => {}, 1000);",
    ],
  });
  await proc.start();
  try {
    const tail = await waitForStderrTail(proc, "DIAGNOSTIC_TAIL");
    assert.ok(Buffer.byteLength(tail, "utf8") <= 64 * 1024);
    assert.ok(tail.endsWith("DIAGNOSTIC_TAIL"));
    assert.ok(!tail.includes("�"), "截断不得破坏 UTF-8 code point");
  } finally {
    await proc.close();
  }
});

test("JsonlProcess: completed stderr 行连同 LF 不超过 64KiB", async () => {
  const proc = new JsonlProcess({
    command: process.execPath,
    args: [
      "-e",
      "process.stderr.write('x'.repeat(300000) + 'COMPLETED_TAIL\\n')",
    ],
  });
  await proc.start();
  try {
    const tail = await waitForStderrTail(proc, "COMPLETED_TAIL\n");
    assert.ok(Buffer.byteLength(tail, "utf8") <= 64 * 1024);
    assert.ok(tail.endsWith("COMPLETED_TAIL\n"));
    assert.ok(!tail.includes("�"));
  } finally {
    await proc.close();
  }
});

test("JsonlProcess: 重复 start 显式抛错", async () => {
  const proc = new JsonlProcess({
    command: process.execPath,
    args: ["-e", "setTimeout(() => {}, 100)"],
  });
  await proc.start();
  await assert.rejects(proc.start(), /重复|already/i);
  await proc.close();
});

test("JsonlProcess: send 到已关闭进程抛错", async () => {
  const proc = new JsonlProcess({
    command: process.execPath,
    args: ["-e", ""],
  });
  await proc.start();
  await proc.close();
  assert.throws(() => proc.send({ type: "x" }), /进程未运行|not running/i);
});
