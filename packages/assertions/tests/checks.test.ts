/**
 * @module @x-agent-suite/assertions/tests/checks
 * 检查层单元测试：dry / hard / fuzzy / enumerate 与工具匹配原语。
 * 不变量：
 * - hard 断言只看 ToolCall.status 与结构化入参；
 * - fuzzy 的多 pattern 是 AND（每个 pattern 都必须命中），不是「任一命中」；
 * - hardChecks 的 args 是浅层 JSON 相等，不同于 tool-call 判据的递归子集。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkListResult,
  dryChecks,
  fuzzyChecks,
  hardChecks,
  toolActionMatches,
  toolNameMatches,
} from "../src/index.ts";
import { makeObservation } from "./support.ts";

// ---------- 工具匹配原语 ----------

test("toolNameMatches：裸名与命名空间末段均命中", () => {
  assert.equal(toolNameMatches({ name: "read", input: {} }, "read"), true);
  assert.equal(
    toolNameMatches({ name: "mcp__fs__read", input: {} }, "read"),
    true,
  );
  assert.equal(toolNameMatches({ name: "ns_read", input: {} }, "read"), true);
  assert.equal(toolNameMatches({ name: "reader", input: {} }, "read"), false);
});

test("toolActionMatches：仅 input.action 精确相等才算命中", () => {
  assert.equal(
    toolActionMatches({ name: "todo", input: { action: "list" } }, "list"),
    true,
  );
  assert.equal(
    toolActionMatches({ name: "todo", input: { action: "create" } }, "list"),
    false,
  );
  assert.equal(
    toolActionMatches({ name: "todo", input: "list" }, "list"),
    false,
  );
});

// ---------- dry ----------

test("dryChecks：结构合法返回空失败列表", () => {
  assert.deepEqual(
    dryChecks(
      makeObservation("", [{ name: "read", input: {}, status: "completed" }]),
    ),
    [],
  );
});

test("dryChecks：events 为空、计数不一致、状态非法均显式点名", () => {
  assert.match(dryChecks(makeObservation("", [], [])).join("\n"), /events/);

  const mismatched = { ...makeObservation(""), toolCallsCount: 3 };
  assert.match(dryChecks(mismatched).join("\n"), /toolCallsCount/);

  const badStatus = makeObservation("", [
    { name: "read", input: {}, status: "running" as unknown as "failed" },
  ]);
  assert.match(dryChecks(badStatus).join("\n"), /status/);
});

// ---------- hard ----------

test("hardChecks：期望工具 completed 且无 args 时通过", () => {
  assert.deepEqual(
    hardChecks(
      makeObservation("", [{ name: "read", input: {}, status: "completed" }]),
      { tool: "read" },
    ),
    [],
  );
});

test("hardChecks：未调用、未完成、action/args 不匹配逐条点名", () => {
  assert.match(
    hardChecks(makeObservation(""), { tool: "read" }).join("\n"),
    /未调用 read/,
  );

  assert.match(
    hardChecks(
      makeObservation("", [{ name: "read", input: {}, status: "failed" }]),
      { tool: "read" },
    ).join("\n"),
    /completed/,
  );

  assert.match(
    hardChecks(
      makeObservation("", [
        { name: "todo", input: { action: "list" }, status: "completed" },
      ]),
      { tool: "todo", action: "create" },
    ).join("\n"),
    /action=create/,
  );

  assert.match(
    hardChecks(
      makeObservation("", [
        { name: "write", input: { path: "b" }, status: "completed" },
      ]),
      { tool: "write", args: { path: "a" } },
    ).join("\n"),
    /入参不匹配/,
  );
});

test("hardChecks：args 为浅层 JSON 相等，嵌套对象不做递归子集", () => {
  const nested = makeObservation("", [
    {
      name: "write",
      input: { opts: { deep: 1, extra: 2 } },
      status: "completed",
    },
  ]);
  assert.equal(
    hardChecks(nested, { tool: "write", args: { opts: { deep: 1 } } }).length,
    1,
  );
  assert.deepEqual(
    hardChecks(nested, {
      tool: "write",
      args: { opts: { deep: 1, extra: 2 } },
    }),
    [],
  );
});

// ---------- fuzzy ----------

test("fuzzyChecks：全部 pattern 命中返回空失败列表", () => {
  assert.deepEqual(fuzzyChecks("hello world", ["hello", "world"]), []);
});

test("fuzzyChecks：多 pattern 为 AND 语义，缺一即失败", () => {
  const failures = fuzzyChecks("hello", ["hello", "bye"]);
  assert.equal(failures.length, 1);
  assert.match(failures[0]!, /bye/);
});

test("fuzzyChecks：字符串按包含、RegExp 按 source+flags 匹配", () => {
  assert.deepEqual(fuzzyChecks("id: 42", [/\d+/g]), []);
  assert.equal(fuzzyChecks("id: x", [/^\d+$/]).length, 1);
});

test("fuzzyChecks：空 pattern 列表不产生失败", () => {
  assert.deepEqual(fuzzyChecks("任意文本", []), []);
});

test("fuzzyChecks：重复使用 g/y 正则不受 lastIndex 污染", () => {
  const patterns = [/ok/g, /ok/y];
  assert.deepEqual(fuzzyChecks("ok", patterns), []);
  assert.deepEqual(fuzzyChecks("ok", patterns), []);
});

// ---------- enumerate ----------

test("checkListResult：列出不存在的 id 记为 hallucinated", () => {
  const result = checkListResult("有 a1, a2, z9", ["a1", "a2"], {
    extract: /a\d+|z\d+/g,
    requireComplete: true,
  });
  assert.deepEqual(result.hallucinated, ["z9"]);
  assert.deepEqual(result.missing, []);
});

test("checkListResult：requireComplete 控制 missing，重复列举去重", () => {
  const complete = checkListResult("a1 a1", ["a1", "a2"], {
    extract: /a\d+/g,
    requireComplete: true,
  });
  assert.deepEqual(complete.hallucinated, []);
  assert.deepEqual(complete.missing, ["a2"]);

  const partial = checkListResult("a1", ["a1", "a2"], {
    extract: /a\d+/g,
    requireComplete: false,
  });
  assert.deepEqual(partial.missing, []);
});
