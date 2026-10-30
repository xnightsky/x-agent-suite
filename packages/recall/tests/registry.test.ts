/**
 * @module @x-agent-suite/recall/tests/registry
 * registry 判据注册校验：静态 Criterion 与通用工厂混合注册，加载期形状把关。
 * 不变量：evaluate 与 create 恰有一个；name/scope 合法；重复 scope:name 拒绝；零网络零 token。
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  loadRecallRegistry,
  type RecallCriterionRegistration,
} from "../src/registry.ts";

/** 把判据源码写成临时 registry 模块并加载；source 为 default 导出的 TS 表达式。 */
async function loadCriteria(
  t: TestContext,
  source: string,
): Promise<readonly RecallCriterionRegistration[]> {
  const dir = await mkdtemp(join(tmpdir(), "xas-recall-registry-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "registry.ts");
  await writeFile(
    file,
    "export default { profiles: {}, effectsProfiles: {}, ...(" +
      source +
      ") };\n",
  );
  const registry = await loadRecallRegistry(file);
  return registry.criteria;
}

const STATIC =
  '{ criteria: [{ name: "static-ok", scope: "turn", evaluate: async () => ({ pass: true, score: 1, reason: "" }) }] }';
const FACTORY =
  '{ criteria: [{ name: "factory-ok", scope: "turn", create: async () => ({ name: "factory-ok", scope: "turn", evaluate: async () => ({ pass: true, score: 1, reason: "" }) }) }] }';

test("静态 Criterion 注册保持兼容", async (t) => {
  const criteria = await loadCriteria(t, STATIC);
  assert.equal(criteria.length, 1);
  const criterion = criteria[0]!;
  assert.equal(criterion.name, "static-ok");
  assert.equal(criterion.scope, "turn");
  if (!("evaluate" in criterion)) throw new Error("静态注册项应含 evaluate");
  assert.equal(typeof criterion.evaluate, "function");
  assert.equal("create" in criterion, false);
});

test("通用工厂注册合法：无 evaluate、有 create 时按声明保留", async (t) => {
  const criteria = await loadCriteria(t, FACTORY);
  assert.equal(criteria.length, 1);
  const factory = criteria[0]!;
  assert.equal(factory.name, "factory-ok");
  assert.equal(factory.scope, "turn");
  if (!("create" in factory)) throw new Error("工厂注册项应含 create");
  assert.equal(typeof factory.create, "function");
});

test("静态与工厂混合注册保持声明顺序", async (t) => {
  const criteria = await loadCriteria(
    t,
    "{ criteria: [...(" +
      STATIC +
      ").criteria, ...(" +
      FACTORY +
      ").criteria] }",
  );
  assert.deepEqual(
    criteria.map((item) => item.name),
    ["static-ok", "factory-ok"],
  );
});

test("缺实现与双实现均在加载时拒绝", async (t) => {
  const invalid = [
    '{ criteria: [{ name: "no-impl", scope: "turn" }] }',
    '{ criteria: [{ name: "dual", scope: "turn", evaluate: async () => ({ pass: true, score: 1, reason: "" }), create: async () => ({}) }] }',
  ];
  for (const source of invalid) {
    await assert.rejects(loadCriteria(t, source), /恰有一个/);
  }
});

test("name 非空字符串与 scope 合法值均在加载时拒绝", async (t) => {
  const invalid = [
    '{ criteria: [{ name: "", scope: "turn", evaluate: async () => ({}) }] }',
    '{ criteria: [{ name: "no-scope", evaluate: async () => ({}) }] }',
    '{ criteria: [{ name: "bad-scope", scope: "run", evaluate: async () => ({}) }] }',
    '{ criteria: [{ name: 42, scope: "turn", evaluate: async () => ({}) }] }',
  ];
  for (const source of invalid) {
    await assert.rejects(loadCriteria(t, source), /name|scope/);
  }
});

test("重复 scope:name 与非法项、非数组在加载时拒绝", async (t) => {
  const invalid = [
    "{ criteria: [...(" +
      STATIC +
      ').criteria, { name: "static-ok", scope: "turn", create: async () => ({}) }] }',
    "{ criteria: [null] }",
    '{ criteria: "nope" }',
  ];
  for (const source of invalid) {
    await assert.rejects(loadCriteria(t, source));
  }
});
