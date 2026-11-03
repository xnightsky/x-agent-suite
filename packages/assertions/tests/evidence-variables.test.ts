/**
 * @module @x-agent-suite/assertions/tests/evidence-variables
 * evidence.toolResult.contains 的显式变量注入与完整声明准备测试。
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { TurnCriterionContext } from "@x-agent-suite/contracts";
import { createEvidenceCriterion, evidence } from "../src/index.ts";
import { evaluateSync, makeContext, makeTurn } from "./support.ts";
import { readCall } from "./evidence-support.ts";

interface FakeResolverOptions {
  readonly values?: Readonly<Record<string, unknown>>;
  readonly log?: string[];
}

function fakeResolver(options: FakeResolverOptions = {}) {
  return {
    prepareValue(value: unknown, _context: TurnCriterionContext) {
      options.log?.push("prepare:" + String(value));
      if (value === "{{ bad }}") throw new TypeError("非法变量引用");
      return {
        resolve: () => {
          options.log?.push("resolve:" + String(value));
          if (
            typeof value === "string" &&
            options.values?.[value] !== undefined
          ) {
            return options.values[value];
          }
          return value;
        },
      };
    },
  };
}

test("仅 toolResult.contains 经工厂选项解析，整值数组满足原字段校验", () => {
  const criterion = createEvidenceCriterion({
    variables: fakeResolver({ values: { "{{ expected }}": ["变量正文"] } }),
  });
  const result = evaluateSync(
    criterion,
    makeTurn("", [readCall("docs/a.md", "变量正文")]),
    makeContext({ toolResult: { tool: "read", contains: "{{ expected }}" } }),
  );
  assert.equal(result.pass, true);

  const literalTool = evaluateSync(
    criterion,
    makeTurn("", [readCall("docs/a.md", "变量正文")]),
    makeContext({
      toolResult: { tool: "{{ tool }}", contains: ["变量正文"] },
    }),
  );
  assert.equal(literalTool.pass, false, "其他字段不得被全局替换");
});

test("完整声明准备先于任何求值，未命中 not 分支的非法引用仍失败", () => {
  const log: string[] = [];
  const criterion = createEvidenceCriterion({
    variables: fakeResolver({ log }),
  });
  assert.throws(
    () =>
      evaluateSync(
        criterion,
        makeTurn("", [readCall("docs/a.md", "正文")]),
        makeContext({
          allOf: [
            {
              name: "content",
              toolResult: { tool: "read", contains: ["{{ good }}"] },
            },
            {
              name: "invalid",
              not: {
                toolResult: { tool: "read", contains: "{{ bad }}" },
              },
            },
          ],
        }),
      ),
    /非法变量引用/,
  );
  assert.deepEqual(log, ["prepare:{{ good }}", "prepare:{{ bad }}"]);
});

test("求值后重新执行 contains 类型校验，未注入解析器时模板显式报配置错误", () => {
  const criterion = createEvidenceCriterion({
    variables: fakeResolver({ values: { "{{ expected }}": 42 } }),
  });
  assert.throws(
    () =>
      evaluateSync(
        criterion,
        makeTurn("", [readCall("docs/a.md")]),
        makeContext({
          toolResult: { tool: "read", contains: "{{ expected }}" },
        }),
      ),
    /contains.*数组/,
  );
  assert.throws(
    () =>
      evaluateSync(
        evidence,
        makeTurn("", [readCall("docs/a.md", "{{ vars.expected }}")]),
        makeContext({
          toolResult: { tool: "read", contains: ["{{ vars.expected }}"] },
        }),
      ),
    /变量|解析器/,
  );
});

test("已声明 contains 求值为 undefined 时不得静默删除约束", () => {
  const criterion = createEvidenceCriterion({
    variables: { prepareValue: () => ({ resolve: () => undefined }) },
  });
  assert.throws(
    () =>
      evaluateSync(
        criterion,
        makeTurn("", [readCall("docs/a.md", "任意正文")]),
        makeContext({
          toolResult: { tool: "read", contains: "{{ expected }}" },
        }),
      ),
    /contains.*(?:undefined|数组)/,
  );
});

test("contains 求值后的空值、布尔、对象、空数组和空字符串元素均按定义错误拒绝", () => {
  for (const value of [null, true, { nested: true }, [], [""]]) {
    const criterion = createEvidenceCriterion({
      variables: fakeResolver({ values: { "{{ expected }}": value } }),
    });
    assert.throws(
      () =>
        evaluateSync(
          criterion,
          makeTurn("", [readCall("docs/a.md", "任意正文")]),
          makeContext({
            toolResult: { tool: "read", contains: "{{ expected }}" },
          }),
        ),
      /contains.*数组/,
      String(value),
    );
  }
});

test("成功路径同样先准备全树再统一求值", () => {
  const log: string[] = [];
  const criterion = createEvidenceCriterion({
    variables: fakeResolver({
      log,
      values: { "{{ first }}": ["正文"], "{{ second }}": ["正文"] },
    }),
  });
  const result = evaluateSync(
    criterion,
    makeTurn("", [readCall("docs/a.md", "正文")]),
    makeContext({
      allOf: [
        {
          name: "first",
          toolResult: { tool: "read", contains: "{{ first }}" },
        },
        {
          name: "second",
          toolResult: { tool: "read", contains: "{{ second }}" },
        },
      ],
    }),
  );
  assert.equal(result.pass, true);
  assert.deepEqual(log, [
    "prepare:{{ first }}",
    "prepare:{{ second }}",
    "resolve:{{ first }}",
    "resolve:{{ second }}",
  ]);
});

test("citation.contains 不触发变量解析，模板仍按字面值匹配", () => {
  const log: string[] = [];
  const criterion = createEvidenceCriterion({
    variables: fakeResolver({ log, values: { "{{ expected }}": ["正文"] } }),
    resolveWorkspaceCwd: () => "/sandbox/root",
  });
  const turn = {
    ...makeTurn("docs/a.md", [readCall("docs/a.md", "正文")]),
    metadata: { workspaceCwd: "/sandbox/root" },
  };
  const result = evaluateSync(
    criterion,
    turn,
    makeContext({
      citation: {
        tool: "read",
        pathArg: "path",
        path: "docs/a.md",
        contains: ["{{ expected }}"],
      },
    }),
  );
  assert.equal(result.pass, false);
  assert.deepEqual(log, []);
});
