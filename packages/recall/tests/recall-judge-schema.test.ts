/**
 * @module @x-agent-suite/recall/tests/recall-judge-schema
 * case 级 Judge 简写/完整形态、封闭 score 与定义错误测试。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { stringify } from "yaml";
import { parseRecallYaml } from "../src/schema.ts";
import { compileRecallCaseExpect } from "../src/assertion-dsl.ts";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { args, workspace } from "./fixtures/recall-workspace.ts";
import { runOfficialCli } from "./fixtures/official-cli.ts";
import { readJudgeRequests } from "./fixtures/recall-judge.registry.ts";

function yaml(expect: unknown): string {
  return stringify({
    version: 1,
    id: "schema",
    cases: [{ id: "case", turns: [{ send: "answer" }], expect }],
  });
}

function judgeOf(source: string) {
  return parseRecallYaml(source, "suite.yaml").cases[0]!.expect!.judge!;
}

test("完整 Judge 保留 rubrics、执行参数与各 rubric 独立 score", () => {
  const judge = judgeOf(
    yaml({
      judge: {
        timeoutMs: 1234,
        maxRetries: 0,
        instructions: "只按最终文本判断",
        rubrics: {
          accurate: { rubric: "是否准确", score: { hit: 3 } },
          concise: { rubric: "是否简洁", score: {} },
          careful: { rubric: "是否谨慎", score: { miss: 0 } },
        },
      },
    }),
  );
  assert.deepEqual(judge, {
    timeoutMs: 1234,
    maxRetries: 0,
    instructions: "只按最终文本判断",
    rubrics: {
      accurate: { rubric: "是否准确", score: { hit: 3 } },
      concise: { rubric: "是否简洁", score: {} },
      careful: { rubric: "是否谨慎", score: { miss: 0 } },
    },
  });
});

test("Judge rubric、score 与完整执行参数均为封闭严格 schema", () => {
  const invalid: readonly [string, unknown, RegExp][] = [
    ["空裁定池", {}, /至少|rubrics/],
    ["空白名", { " ": { rubric: "x" } }, /名/],
    ["点号名", { "bad.name": { rubric: "x" } }, /点号/],
    ["空 rubric", { ok: { rubric: " " } }, /rubric/],
    ["rubric 未知字段", { ok: { rubric: "x", extra: 1 } }, /未知字段/],
    ["score 数组", { ok: { rubric: "x", score: [] } }, /score|对象/],
    ["score null", { ok: { rubric: "x", score: null } }, /score|对象/],
    [
      "score 未知字段",
      { ok: { rubric: "x", score: { weight: 1 } } },
      /未知字段/,
    ],
    ["hit 非有限", { ok: { rubric: "x", score: { hit: Infinity } } }, /有限/],
    ["miss 非有限", { ok: { rubric: "x", score: { miss: NaN } } }, /有限/],
    ["hit null", { ok: { rubric: "x", score: { hit: null } } }, /有限/],
    [
      "完整未知字段",
      { rubrics: { ok: { rubric: "x" } }, extra: 1 },
      /未知字段/,
    ],
    ["完整空 rubrics", { rubrics: {} }, /至少/],
    ["缺 rubrics", { timeoutMs: 100 }, /rubrics/],
    [
      "timeout 零",
      { rubrics: { ok: { rubric: "x" } }, timeoutMs: 0 },
      /timeoutMs/,
    ],
    [
      "retries 负数",
      { rubrics: { ok: { rubric: "x" } }, maxRetries: -1 },
      /maxRetries/,
    ],
    [
      "instructions 空白",
      { rubrics: { ok: { rubric: "x" } }, instructions: " " },
      /instructions/,
    ],
  ];
  for (const [name, judge, expected] of invalid) {
    assert.throws(
      () => parseRecallYaml(yaml({ judge }), "suite.yaml"),
      expected,
      name,
    );
  }
});

test("重复 YAML key 与旧 case decision 在解析期拒绝", () => {
  assert.throws(
    () =>
      parseRecallYaml(
        [
          "version: 1",
          "id: schema",
          "cases:",
          "  - id: case",
          "    turns: [{ send: answer }]",
          "    expect:",
          "      judge:",
          "        same: { rubric: first }",
          "        same: { rubric: second }",
          "",
        ].join("\n"),
        "suite.yaml",
      ),
    /duplicate|重复|unique/i,
  );
  assert.throws(
    () => parseRecallYaml(yaml({ decision: { dimensions: [] } }), "suite.yaml"),
    /decision/,
  );
});

test("非法 AI score 与机械 resolver 均为 CLI=2 且主执行/Judge 零调用", async (t) => {
  const fixtureUrl = new URL(
    "./fixtures/recall-judge.registry.ts",
    import.meta.url,
  ).href;
  const cases = [
    {
      expect: { judge: { ok: { rubric: "x", score: { hit: Infinity } } } },
      registry: "export { default } from " + JSON.stringify(fixtureUrl) + ";\n",
    },
    {
      expect: { "bad-resolver": {} },
      registry:
        "import base from " +
        JSON.stringify(fixtureUrl) +
        ";\n" +
        "export default { ...base, criteria: [...base.criteria, { name: 'bad-resolver', scope: 'session', assertionScore: () => Promise.resolve({}), evaluate: () => ({ pass: true, score: 1, reason: '' }) }] };\n",
    },
  ];
  for (const item of cases) {
    const ws = await workspace(t);
    await writeFile(ws.registryPath, item.registry);
    await writeFile(ws.recallPath, yaml(item.expect));
    const requestLog = join(ws.cwd, "requests.jsonl");
    await writeFile(requestLog, "");
    const executed = await runOfficialCli(args(ws, join(ws.cwd, "reports")), {
      homeDir: ws.cwd,
      env: { XAS_RECALL_TEST_JUDGE_LOG: requestLog },
    });
    assert.equal(executed.code, 2, executed.stderr);
    assert.deepEqual(await readJudgeRequests(requestLog), []);
  }
});

test("__proto__ 是合法 rubric/机械名，不得被内部对象原型吞掉", () => {
  const judge = judgeOf(yaml({ judge: { ["__proto__"]: { rubric: "safe" } } }));
  assert.deepEqual(Object.keys(judge.rubrics), ["__proto__"]);
  assert.equal(judge.rubrics["__proto__"]!.rubric, "safe");

  const compiled = compileRecallCaseExpect({
    ["__proto__"]: { raw: true },
  });
  assert.deepEqual(Object.keys(compiled.expect ?? {}), ["__proto__"]);
  assert.deepEqual(compiled.expect?.["__proto__"], { raw: true });
});

test("线性 turn Judge 复用 case DSL", () => {
  const definition = parseRecallYaml(
    stringify({
      version: 1,
      id: "turn-schema",
      cases: [
        {
          id: "case",
          turns: [
            {
              send: "准备",
              expect: {
                judge: { ready: { rubric: "是否就绪", score: { hit: 0 } } },
              },
            },
          ],
        },
      ],
    }),
    "suite.yaml",
  );
  assert.deepEqual(definition.cases[0]!.turns[0]!.expect?.judge, {
    rubrics: { ready: { rubric: "是否就绪", score: { hit: 0 } } },
  });
});

test("turn Judge 的非法 score 与 rubric 不绕过封闭校验", () => {
  for (const judge of [
    { ok: { rubric: "x", score: { hit: null } } },
    { "bad.name": { rubric: "x" } },
  ]) {
    assert.throws(() =>
      parseRecallYaml(
        stringify({
          version: 1,
          id: "invalid-turn-judge",
          cases: [
            {
              id: "case",
              turns: [{ send: "a", expect: { judge } }],
            },
          ],
        }),
        "suite.yaml",
      ),
    );
  }
});
