/**
 * @module @x-agent-suite/driver/tests/proc
 * JsonlProcess 分帧回归：Unicode 分隔符、stdout 错误传播和 stderr 有界诊断。
 * 不变量：只启动通用测试子进程，零 token；分帧错误必须能由调用方捕获，不得逃逸事件回调。
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

for (const [name, output] of [
  ["未换行超长输出", "'x'.repeat(1024 * 1024 + 1)"],
  [
    "仅 EOF 解码冲刷后超长的输出",
    "Buffer.concat([Buffer.alloc(1024 * 1024 - 1, 'x'), Buffer.from([0xe2])])",
  ],
] as const) {
  test(`JsonlProcess：${name}可捕获且调用者正常退出`, () => {
    const source = `
      import assert from 'node:assert/strict';
      import { JsonlProcess } from ${JSON.stringify(new URL("../src/proc.ts", import.meta.url).href)};
      const proc = new JsonlProcess({
        command: process.execPath,
        args: ['-e', ${JSON.stringify(`process.stdout.write(${output})`)}],
      });
      await proc.start();
      try {
        await assert.rejects(async () => {
          for await (const line of proc.lines()) {
            assert.fail('超长行不得产出 JSON');
          }
        }, /LfFramer: 单行超长/);
        process.stdout.write('caught\\n');
      } finally {
        await proc.close();
      }
    `;
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx/esm"),
        "--input-type=module",
        "-e",
        source,
      ],
      { encoding: "utf8", timeout: 10_000 },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.signal, null);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "caught\n");
  });
}

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
  // 轮询等末行进环（固定 sleep 在慢机器上会在子进程输出前 close，tail 为空假失败）。
  await waitForStderrTail(proc, "chunk-4\n");
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
