/**
 * @module @x-agent-suite/recall/tests/recall-var
 * recall-var 静态声明、转义、类型保持与命名空间单元测试。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeRecallVariables,
  prepareRecallVariableValue,
  type RecallStaticVariableContext,
} from "../src/recall-var.ts";

const context: RecallStaticVariableContext = {
  vars: {
    text: "正文",
    number: 23,
    boolean: true,
    nil: null,
    list: ["a", 1],
    object: { total: 2 },
    recursive: "{{ vars.text }}",
  },
  scenario: {
    id: "suite",
    file: "/repo/.recall/suite.yaml",
    dir: "/repo/.recall",
    rootDir: "/repo",
  },
  case: { id: "example" },
  plan: { name: "none" },
};

function resolve(value: unknown, turnIndex = 0): unknown {
  return prepareRecallVariableValue(value, context, turnIndex).resolve();
}

test("整值引用保持 JSON 类型，嵌入引用拼接多个静态值与 turn.index", () => {
  assert.equal(resolve("{{ vars.text }}"), "正文");
  assert.equal(resolve("{{vars.number}}"), 23);
  assert.equal(resolve("{{ vars.boolean }}"), true);
  assert.equal(resolve("{{ vars.nil }}"), null);
  assert.deepEqual(resolve("{{ vars.list }}"), ["a", 1]);
  assert.deepEqual(resolve("{{ vars.object }}"), { total: 2 });
  assert.equal(
    resolve(
      "{{ vars.text }}:{{ scenario.id }}/{{ case.id }}/{{ plan.name }}/{{ turn.index }}",
      3,
    ),
    "正文:suite/example/none/3",
  );
});

test("转义只处理反斜杠模板符，变量求值结果不递归展开", () => {
  assert.equal(
    resolve(String.raw`\{{ vars.text }}|{{ vars.text }}|\path`),
    String.raw`{{ vars.text }}|正文|\path`,
  );
  assert.equal(resolve("{{ vars.recursive }}"), "{{ vars.text }}");
  assert.equal(
    resolve("prefix-{{ vars.recursive }}"),
    "prefix-{{ vars.text }}",
  );
});

test("数组和对象的值递归准备但不处理键名", () => {
  assert.deepEqual(
    resolve({
      "{{ vars.text }}": ["{{ vars.number }}", { hit: "{{ vars.boolean }}" }],
    }),
    { "{{ vars.text }}": [23, { hit: true }] },
  );
});

test("非标量嵌入在求值阶段拒绝，未知或非法引用在准备阶段拒绝", () => {
  for (const value of [
    "{{ vars.nil }}",
    "{{ vars.list }}",
    "{{ vars.object }}",
  ]) {
    assert.throws(() => resolve("prefix-" + value), /嵌入|字符串/);
  }
  for (const value of [
    "{{ vars.missing }}",
    "{{ vars.text.extra }}",
    "{{ scenario.missing }}",
    "{{ scenario.constructor }}",
    "{{ run.cwd }}",
    "{{ resources.entry.dir }}",
    "{{ steps.local }}",
    "{{ vars.text",
    "{{ }}",
  ]) {
    assert.throws(
      () => prepareRecallVariableValue(value, context, 0),
      /引用|变量|阶段 1|不支持/,
      value,
    );
  }
});

test("嵌入引用拼接零、负有限小数与布尔值，其他反斜杠保持不变", () => {
  const local = {
    ...context,
    vars: {
      ...context.vars,
      zero: 0,
      amount: -1.25,
      enabled: false,
      allowed: true,
    },
  };
  const prepared = prepareRecallVariableValue(
    String.raw`n={{ vars.amount }};zero={{ vars.zero }};flag={{ vars.enabled }};ok={{ vars.allowed }};literal\keep`,
    local,
    0,
  );
  assert.equal(
    prepared.resolve(),
    String.raw`n=-1.25;zero=0;flag=false;ok=true;literal\keep`,
  );
});

test("vars 浅合并分别证明优先级、未覆盖保留和同名对象整体替换", () => {
  const documentObject = { from: "document" };
  const caseObject = { from: "case" };
  const merged = mergeRecallVariables(
    { keep: "document", shared: documentObject, planShared: "document" },
    { shared: { from: "plan" }, planShared: "plan", planOnly: "plan" },
    { shared: caseObject },
  );
  assert.deepEqual(merged, {
    keep: "document",
    shared: caseObject,
    planShared: "plan",
    planOnly: "plan",
  });
  assert.equal(
    merged.shared,
    caseObject,
    "嵌套对象整体替换，不做深合并或深克隆",
  );
});
