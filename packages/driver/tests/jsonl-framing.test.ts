/**
 * @module @x-agent-suite/driver/tests/jsonl-framing
 * 严格 LF 分帧器回归测试：U+2028 / U+2029 不得断行、\r\n 容忍、
 * 多字节 UTF-8 跨 chunk、end 冲刷残留行、超长行显式报错。
 * 不变量：只以 \n 为记录分隔符；所有错误显式抛带上下文的 Error。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { LfFramer } from "../src/jsonl-framing.ts";

/** 收集 push 产生的所有行。 */
function collect() {
  const lines: string[] = [];
  const framer = new LfFramer((line) => lines.push(line));
  return { framer, lines };
}

test("LfFramer：仅以 \\n 分隔，一次 push 多行", () => {
  const { framer, lines } = collect();
  framer.push(Buffer.from('{"a":1}\n{"b":2}\n', "utf8"));
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
});

test("LfFramer：U+2028 / U+2029 在 JSON 字符串内不断行", () => {
  const { framer, lines } = collect();
  const text = "a\u2028b\u2029c";
  const line = JSON.stringify({ text });
  framer.push(Buffer.from(`${line}\n`, "utf8"));
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0] as string) as { text: string };
  assert.equal(parsed.text, text);
});

test("LfFramer：容忍并剥除行尾 \\r", () => {
  const { framer, lines } = collect();
  framer.push(Buffer.from('{"a":1}\r\n{"b":2}\r\n', "utf8"));
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
});

test("LfFramer：多字节 UTF-8 跨 chunk 不错乱", () => {
  const { framer, lines } = collect();
  const buf = Buffer.from('{"text":"中文🙂"}\n', "utf8");
  // 从多字节字符中间切开
  const mid = buf.indexOf(0xe4);
  framer.push(buf.subarray(0, mid + 1));
  framer.push(buf.subarray(mid + 1));
  assert.deepEqual(lines, ['{"text":"中文🙂"}']);
  assert.equal(
    (JSON.parse(lines[0] as string) as { text: string }).text,
    "中文🙂",
  );
});

test("LfFramer：end() 冲刷末尾无换行的残留行", () => {
  const { framer, lines } = collect();
  framer.push(Buffer.from('{"a":1}\n{"b":2}', "utf8"));
  assert.deepEqual(lines, ['{"a":1}']);
  framer.end();
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
});

test("LfFramer：空行原样产出（由消费方过滤）", () => {
  const { framer, lines } = collect();
  framer.push(Buffer.from('{"a":1}\n\n{"b":2}\n', "utf8"));
  assert.deepEqual(lines, ['{"a":1}', "", '{"b":2}']);
});

test("LfFramer：超长行显式抛带上下文的错", () => {
  const framer = new LfFramer(() => {}, { maxLineBytes: 16 });
  assert.throws(
    () => framer.push(Buffer.from("x".repeat(64), "utf8")),
    /超长.*16.*64|exceed/i,
  );
});

test("LfFramer：带换行的完整超长行在回调前显式抛错", () => {
  const lines: string[] = [];
  const framer = new LfFramer((line) => lines.push(line), { maxLineBytes: 3 });
  assert.throws(
    () => framer.push(Buffer.from("1234\n", "utf8")),
    /超长.*3.*4|exceed/i,
  );
  assert.deepEqual(lines, []);
});

test("LfFramer：end 冲刷的残留超长行同样显式抛错", () => {
  const framer = new LfFramer(() => {}, { maxLineBytes: 3 });
  assert.throws(() => {
    framer.push(Buffer.from("1234", "utf8"));
    framer.end();
  }, /超长.*3.*4|exceed/i);
});

test("LfFramer：end() 后禁止再 push", () => {
  const { framer } = collect();
  framer.end();
  assert.throws(() => framer.push(Buffer.from("a\n")), /end|结束/);
});

test("LfFramer：\\r\\n 跨 chunk 边界正确剥除 \\r", () => {
  const { framer, lines } = collect();
  framer.push(Buffer.from('{"a":1}\r', "utf8"));
  framer.push(Buffer.from('\n{"b":2}\r\n', "utf8"));
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
});

test("LfFramer：push 空字节不抛错且不产出空行", () => {
  const { framer, lines } = collect();
  framer.push(Buffer.alloc(0));
  framer.push(Buffer.from('{"a":1}\n', "utf8"));
  framer.end();
  assert.deepEqual(lines, ['{"a":1}']);
});
