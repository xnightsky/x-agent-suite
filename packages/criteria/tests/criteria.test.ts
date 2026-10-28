/**
 * @module @x-agent-suite/criteria/tests/criteria
 * 验证旧判据入口仍是新断言实现的原样重导出；行为回归由 assertions 包负责。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import * as assertions from "@x-agent-suite/assertions";
import * as legacy from "../src/index.ts";

test("判据兼容入口不复制实现，也不新增默认判据", () => {
  assert.deepEqual(Object.keys(legacy).sort(), [
    "textContains",
    "textNotContains",
    "toolCall",
  ]);
  assert.equal(legacy.textContains, assertions.textContains);
  assert.equal(legacy.textNotContains, assertions.textNotContains);
  assert.equal(legacy.toolCall, assertions.toolCall);
});
