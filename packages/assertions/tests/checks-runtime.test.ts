/** 检查层运行时结构校验与 JSON 相等回归。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { dryChecks, hardChecks } from "../src/index.ts";
import { makeObservation } from "./support.ts";

test("dryChecks：拒绝 text、events、count 和 ToolCall 核心字段畸形", () => {
  const malformed = {
    text: 42,
    toolCalls: [{ name: "read", input: {}, status: "completed" }],
    toolCallsCount: 1,
    events: [null],
  };
  const failures = dryChecks(malformed as never);
  assert.match(failures.join("\n"), /text/i);
  assert.match(failures.join("\n"), /events/i);
  assert.match(failures.join("\n"), /events|对象|timestamp/i);

  assert.match(
    dryChecks({
      text: "",
      toolCalls: [],
      toolCallsCount: -1,
      events: [{ type: "text", timestamp: 1 }],
    } as never).join("\n"),
    /toolCallsCount/,
  );
  assert.match(
    dryChecks({
      text: "",
      toolCalls: [{ name: "", input: {}, status: "running" }],
      toolCallsCount: 1,
      events: [{ type: "text", timestamp: 1 }],
    } as never).join("\n"),
    /name|status/,
  );
});

test("hardChecks：键序无关、own property 与 NaN/null 不混淆", () => {
  const keyOrder = makeObservation("", [
    {
      name: "write",
      input: { opts: { b: 2, a: 1 } },
      status: "completed",
    },
  ]);
  assert.deepEqual(
    hardChecks(keyOrder, { tool: "write", args: { opts: { a: 1, b: 2 } } }),
    [],
  );

  const inheritedInput = Object.create({ path: "a" }) as Record<
    string,
    unknown
  >;
  inheritedInput.other = true;
  const inherited = makeObservation("", [
    { name: "write", input: inheritedInput, status: "completed" },
  ]);
  assert.match(
    hardChecks(inherited, { tool: "write", args: { path: "a" } }).join("\n"),
    /入参/,
  );

  const nullInput = makeObservation("", [
    { name: "write", input: { x: null }, status: "completed" },
  ]);
  assert.throws(
    () => hardChecks(nullInput, { tool: "write", args: { x: Number.NaN } }),
    /args|有限|JSON/,
  );
});

test("hardChecks：非法期望形状显式抛错", () => {
  const observation = makeObservation("", [
    { name: "read", input: {}, status: "completed" },
  ]);
  const invalid: unknown[] = [
    null,
    {},
    { tool: "" },
    { tool: "read", action: null },
    { tool: "read", args: null },
    { tool: "read", args: [] },
    { tool: "read", actionn: "x" },
    { tool: "read", args: { x: Number.POSITIVE_INFINITY } },
  ];
  for (const expected of invalid) {
    assert.throws(
      () => hardChecks(observation, expected as never),
      /hard|tool|action|args|未知字段|有限/,
      String(expected),
    );
  }
});
