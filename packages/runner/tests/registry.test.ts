/**
 * @module @x-agent-suite/runner/tests/registry
 * RuntimeRegistry 单元测试：注册、冲突、查找、读侧枚举。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Criterion, DriverRegistration } from "@x-agent-suite/contracts";
import { MockDriver } from "@x-agent-suite/driver";
import { createRegistry } from "../src/registry.ts";

/** 构造最小 driver 注册项。 */
function makeDriver(id: string): DriverRegistration {
  return Object.assign(new MockDriver(), { id });
}

/** 构造演示判据。 */
function makeCriterion(name: string): Criterion {
  return {
    name,
    scope: "turn",
    evaluate: () => ({ pass: true, score: 1, reason: "" }),
  };
}

test("注册后可按 id/名查找", () => {
  const registry = createRegistry();
  registry.registerDriver(makeDriver("mock"));
  registry.registerCriterion(makeCriterion("demo"));
  assert.equal(registry.driver("mock").id, "mock");
  assert.equal(registry.criterion("turn", "demo").name, "demo");
  assert.equal(registry.criteria().length, 1);
});

test("重复注册显式抛错", () => {
  const registry = createRegistry();
  registry.registerDriver(makeDriver("mock"));
  assert.throws(() => registry.registerDriver(makeDriver("mock")), /重复注册/);
  registry.registerCriterion(makeCriterion("demo"));
  assert.throws(
    () => registry.registerCriterion(makeCriterion("demo")),
    /重复注册/,
  );
});

test("未注册查找显式抛错", () => {
  const registry = createRegistry();
  assert.throws(() => registry.driver("ghost"), /未注册/);
  assert.throws(() => registry.criterion("turn", "ghost"), /未注册/);
});

test("同名判据 turn/session 双 scope 可共存", () => {
  const registry = createRegistry();
  registry.registerCriterion(makeCriterion("demo"));
  registry.registerCriterion({
    name: "demo",
    scope: "session",
    evaluate: () => ({ pass: true, score: 1, reason: "" }),
  });
  assert.equal(registry.criteria().length, 2);
});
