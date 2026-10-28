/**
 * @module @x-agent-suite/assertions/tests/deterministic
 * 确定性断言单元测试：文本包含/排除与工具调用核对。
 * 不变量：expect 形状非法必须显式抛错（配置错误不等于评测失败）。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { textContains, textNotContains, toolCall } from "../src/index.ts";
import { evaluateSync, makeContext, makeTurn } from "./support.ts";

// ---------- text-contains ----------

test("text-contains：全部关键词命中通过", () => {
  const result = evaluateSync(
    textContains,
    makeTurn("答案是：不加载，且需要显式声明"),
    makeContext(["不加载", "显式声明"]),
  );
  assert.equal(result.pass, true);
  assert.equal(result.score, 1);
});

test("text-contains：缺关键词判 fail 且 reason 点名缺失项", () => {
  const result = evaluateSync(
    textContains,
    makeTurn("答案是：不加载"),
    makeContext(["不加载", "显式声明"]),
  );
  assert.equal(result.pass, false);
  assert.equal(result.score, 0);
  assert.match(result.reason, /显式声明/);
});

test("text-contains：单字符串 expect 等价单元素数组", () => {
  const result = evaluateSync(
    textContains,
    makeTurn("abc"),
    makeContext("abc"),
  );
  assert.equal(result.pass, true);
});

test("text-contains：expect 形状非法显式抛错", () => {
  const illegal: unknown[] = [[], "", [""], [1], 42, null, undefined];
  for (const expect of illegal) {
    assert.throws(
      () => evaluateSync(textContains, makeTurn("abc"), makeContext(expect)),
      /text-contains.*expect/,
    );
  }
});

// ---------- text-not-contains ----------

test("text-not-contains：红线均未出现通过", () => {
  const result = evaluateSync(
    textNotContains,
    makeTurn("只读结论"),
    makeContext(["rm -rf", "drop table"]),
  );
  assert.equal(result.pass, true);
  assert.equal(result.score, 1);
});

test("text-not-contains：命中任一红线判 fail 且点名", () => {
  const result = evaluateSync(
    textNotContains,
    makeTurn("执行 rm -rf 之后"),
    makeContext(["rm -rf", "drop table"]),
  );
  assert.equal(result.pass, false);
  assert.match(result.reason, /rm -rf/);
});

test("text-not-contains：expect 形状非法显式抛错", () => {
  assert.throws(
    () => evaluateSync(textNotContains, makeTurn("abc"), makeContext([])),
    /text-not-contains.*expect/,
  );
});

// ---------- tool-call ----------

test("tool-call：命中 completed 调用通过", () => {
  const result = evaluateSync(
    toolCall,
    makeTurn("", [
      {
        name: "read",
        input: { path: "a", action: "open" },
        status: "completed",
      },
    ]),
    makeContext({ tool: "read", action: "open" }),
  );
  assert.equal(result.pass, true);
  assert.equal(result.score, 1);
});

test("tool-call：命名空间前缀按末段匹配", () => {
  const result = evaluateSync(
    toolCall,
    makeTurn("", [{ name: "mcp__fs__read", input: {}, status: "completed" }]),
    makeContext({ tool: "read" }),
  );
  assert.equal(result.pass, true);
});

test("tool-call：未调用判 fail 且点名工具", () => {
  const result = evaluateSync(
    toolCall,
    makeTurn("", []),
    makeContext({ tool: "read" }),
  );
  assert.equal(result.pass, false);
  assert.match(result.reason, /read/);
});

test("tool-call：被调用但无一 completed 判 fail", () => {
  const result = evaluateSync(
    toolCall,
    makeTurn("", [{ name: "read", input: {}, status: "failed" }]),
    makeContext({ tool: "read" }),
  );
  assert.equal(result.pass, false);
  assert.match(result.reason, /completed/);
});

test("tool-call：action 不匹配判 fail", () => {
  const result = evaluateSync(
    toolCall,
    makeTurn("", [
      { name: "todo", input: { action: "list" }, status: "completed" },
    ]),
    makeContext({ tool: "todo", action: "create" }),
  );
  assert.equal(result.pass, false);
  assert.match(result.reason, /action/);
});

test("tool-call：args 递归子集匹配通过，多余键不影响", () => {
  const result = evaluateSync(
    toolCall,
    makeTurn("", [
      {
        name: "write",
        input: { path: "a", opts: { deep: 1, extra: 2 } },
        status: "completed",
      },
    ]),
    makeContext({ tool: "write", args: { opts: { deep: 1 } } }),
  );
  assert.equal(result.pass, true);
});

test("tool-call：args 值不等判 fail", () => {
  const result = evaluateSync(
    toolCall,
    makeTurn("", [
      { name: "write", input: { path: "b" }, status: "completed" },
    ]),
    makeContext({ tool: "write", args: { path: "a" } }),
  );
  assert.equal(result.pass, false);
  assert.match(result.reason, /入参/);
});

test("tool-call：expect 形状非法显式抛错", () => {
  const illegal: unknown[] = [{}, { tool: "" }, "read", null];
  for (const expect of illegal) {
    assert.throws(
      () => evaluateSync(toolCall, makeTurn("", []), makeContext(expect)),
      /tool-call.*expect/,
    );
  }
});
