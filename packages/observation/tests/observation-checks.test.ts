/**
 * @module @x-agent-suite/observation/tests/observation-checks
 * 验证检查原语兼容入口不分叉；行为回归由 assertions 包负责。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import * as assertions from "@x-agent-suite/assertions";
import * as legacy from "../src/checks.ts";

test("检查原语兼容入口保持原符号与实现身份", () => {
  const names = [
    "checkListResult",
    "dryChecks",
    "fuzzyChecks",
    "hardChecks",
    "toolActionMatches",
    "toolNameMatches",
  ] as const;
  assert.deepEqual(Object.keys(legacy).sort(), [...names].sort());
  for (const name of names) assert.equal(legacy[name], assertions[name]);
});
