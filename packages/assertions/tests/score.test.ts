/** 通用断言分值配置校验、独立默认与直接贡献测试。 */
import assert from "node:assert/strict";
import test from "node:test";
import { assertionContribution, parseAssertionScore } from "../src/index.ts";

test("score 空对象与部分覆盖保持声明，hit/miss 独立默认", () => {
  assert.deepEqual(parseAssertionScore({}), {});
  assert.deepEqual(parseAssertionScore({ hit: 3 }), { hit: 3 });
  assert.deepEqual(parseAssertionScore({ miss: 0 }), { miss: 0 });
  assert.equal(assertionContribution(true), 1);
  assert.equal(assertionContribution(false), -1);
  assert.equal(assertionContribution(true, {}), 1);
  assert.equal(assertionContribution(false, {}), -1);
  assert.equal(assertionContribution(true, { hit: 3 }), 3);
  assert.equal(assertionContribution(false, { hit: 3 }), -1);
  assert.equal(assertionContribution(true, { miss: 0 }), 1);
  assert.equal(assertionContribution(false, { miss: 0 }), 0);
  assert.equal(assertionContribution(true, { hit: 0 }), 0);
  assert.equal(assertionContribution(false, { hit: 0 }), -1);
});

test("非普通对象、Promise、额外字段与非有限分值显式拒绝", () => {
  for (const value of [
    null,
    [],
    Promise.resolve({}),
    new Date(),
    { hit: Infinity },
    { miss: NaN },
    { hit: null },
    { hit: 1, extra: 2 },
  ]) {
    assert.throws(() => parseAssertionScore(value), /普通对象|有限|未知字段/);
  }
});

test("非法 rejected Promise 显式拒绝，不留下未处理的异步错误", async () => {
  const value = Promise.reject(new Error("resolver-private-detail"));
  assert.throws(() => parseAssertionScore(value), /同步普通对象/);
  await new Promise<void>((resolve) => setImmediate(resolve));
});
