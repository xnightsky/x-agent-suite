/** firstOf 封闭 schema 与评分锚点，零 token。 */
import assert from "node:assert/strict";
import test from "node:test";
import { parseRecallYaml } from "../src/schema.ts";
const yaml = (branches: string) =>
  `version: 1\nid: tiers\ncases:\n  - id: one\n    turns:\n      - send: answer\n    expect:\n      firstOf:\n        quality:\n${branches}\n`;
const valid = `          - name: standard
            score: &standard { hit: 3, miss: -1 }
            expect: { judge: { a: { rubric: strict } } }
          - name: downgrade
            score: { hit: 1, miss: -1 }
            expect: { judge: { b: { rubric: minimum } } }`;
test("解析有序择档且不修改锚点", () => {
  const result = parseRecallYaml(yaml(valid), "exam.yaml");
  assert.ok(result.cases[0]!.expect!.firstOf);
});
for (const [name, branches] of [
  ["miss 不一致", valid.replace("hit: 1, miss: -1", "hit: 1, miss: 0")],
  [
    "档位未知字段",
    valid.replace("name: standard", "name: standard\n            weight: 2"),
  ],
  [
    "子条件重复计分",
    valid.replace("rubric: strict", "rubric: strict, score: { hit: 2 }"),
  ],
  ["重复档名", valid.replace("name: downgrade", "name: standard")],
  [
    "嵌套组合",
    valid.replace(
      "expect: { judge: { a: { rubric: strict } } }",
      "expect: { firstOf: {} }",
    ),
  ],
] as const)
  test(name, () =>
    assert.throws(() => parseRecallYaml(yaml(branches), "exam.yaml")),
  );
for (const value of [
  "{}",
  "[]",
  "null",
  "{ quality: [] }",
  "{ quality: [{name: a, expect: {x: 1}}] }",
  '{ "bad.name": [{name: a, expect: {x: 1}}, {name: b, expect: {x: 1}}] }',
]) {
  test("非法组合结构 " + value, () => {
    const document =
      "version: 1\nid: invalid\ncases:\n  - id: c\n    turns: [{send: hi}]\n    expect:\n      firstOf: " +
      value;
    assert.throws(() => parseRecallYaml(document, "exam.yaml"));
  });
}
for (const score of [
  "{hit: .nan}",
  "{miss: .inf}",
  '{hit: "3"}',
  "{weight: 1}",
  "null",
  "[]",
])
  test("非法分值 " + score, () => {
    assert.throws(() =>
      parseRecallYaml(
        yaml(valid.replace("&standard { hit: 3, miss: -1 }", score)),
        "exam.yaml",
      ),
    );
  });
test("所有档位共享锚点但解析不改写原值，支持零/负数/小数且顺序不由 hit 排序", () => {
  const document = yaml(
    valid
      .replace("hit: 3, miss: -1", "hit: 0, miss: -0.5")
      .replace("{ hit: 1, miss: -1 }", "*standard"),
  );
  const definition = parseRecallYaml(document, "exam.yaml");
  const branches = definition.cases[0]!.expect!.firstOf!.quality!;
  assert.deepEqual(
    branches.map((item) => item.score),
    [
      { hit: 0, miss: -0.5 },
      { hit: 0, miss: -0.5 },
    ],
  );
  assert.deepEqual(
    branches.map((item) => item.name),
    ["standard", "downgrade"],
  );
});
