/**
 * @module @x-agent-suite/assertions/tests/evidence
 * 通用证据判据单元测试：读取、路径、组合与引用均只消费公开 Observation。
 * 不变量：定义/观察错误显式抛出，内容未命中只返回 pass=false。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { evidence } from "../src/index.ts";
import { evaluateSync, makeContext, makeTurn } from "./support.ts";
import {
  output,
  readCall,
  workspaceEvidence,
  workspaceTurn,
} from "./evidence-support.ts";

test("evidence/toolResult：completed 且有非空正文才通过", () => {
  const pass = evaluateSync(
    evidence,
    makeTurn("", [readCall("docs/a.md")]),
    makeContext({ toolResult: { tool: "read" } }),
  );
  assert.equal(pass.pass, true);
  assert.equal(pass.score, 1);

  for (const call of [
    { ...readCall("docs/a.md"), output: output("") },
    { ...readCall("docs/a.md"), output: output(" \n\t") },
    { ...readCall("docs/a.md"), output: undefined },
    { ...readCall("docs/a.md"), output: { content: [] } },
    readCall("docs/a.md", "失败正文", "failed"),
  ]) {
    const result = evaluateSync(
      evidence,
      makeTurn("", [call]),
      makeContext({ toolResult: { tool: "read" } }),
    );
    assert.equal(result.pass, false);
    assert.equal(result.score, 0);
  }
});

test("evidence/toolResult：最终回答自述、未调用和入参不匹配均不构成证据", () => {
  for (const calls of [
    [],
    [readCall("docs/a.md")],
    [{ ...readCall("docs/a.md"), input: { path: "docs/a.md", offset: 2 } }],
  ]) {
    const result = evaluateSync(
      evidence,
      makeTurn("我已经读过 docs/a.md", calls),
      makeContext({ toolResult: { tool: "read", args: { offset: 1 } } }),
    );
    assert.equal(result.pass, false);
    assert.match(result.reason, /read|入参/);
  }
});

test("evidence/toolResult：无路径 contains 要求同一次成功调用覆盖全部片段", () => {
  const expect = {
    toolResult: { tool: "read", contains: ["提取关键词", "完成标准"] },
  };
  assert.equal(
    evaluateSync(
      evidence,
      makeTurn("", [readCall("docs/a.md", "提取关键词\n完成标准")]),
      makeContext(expect),
    ).pass,
    true,
  );
  assert.equal(
    evaluateSync(
      evidence,
      makeTurn("", [
        readCall("docs/a.md", "提取关键词"),
        readCall("docs/a.md", "完成标准"),
      ]),
      makeContext(expect),
    ).pass,
    false,
  );
});

test("evidence/toolResult：相对、点相对、内部绝对与反斜杠路径匹配同一资源", () => {
  for (const path of [
    "docs/a.md",
    "./docs/a.md",
    "/sandbox/root/docs/a.md",
    "docs\\a.md",
  ]) {
    const result = evaluateSync(
      workspaceEvidence(),
      workspaceTurn("", [readCall(path)]),
      makeContext({
        toolResult: {
          tool: "read",
          path: { arg: "path", resource: "docs/a.md" },
        },
      }),
    );
    assert.equal(result.pass, true, path);
  }
});

test("evidence/toolResult：外部同名、伪造前缀与路径逃逸不匹配目标资源", () => {
  for (const path of [
    "/outside/docs/a.md",
    "forged/docs/a.md",
    "../docs/a.md",
    "/sandbox/root-other/docs/a.md",
  ]) {
    const result = evaluateSync(
      workspaceEvidence(),
      workspaceTurn("", [readCall(path)]),
      makeContext({
        toolResult: {
          tool: "read",
          path: { arg: "path", resource: "docs/a.md" },
        },
      }),
    );
    assert.equal(result.pass, false, path);
    assert.doesNotMatch(result.reason, /sandbox\//);
  }
});

test("evidence：缺 workspace、非法路径输入和缺失 status 均按非法观察抛错", () => {
  const expect = {
    toolResult: {
      tool: "read",
      path: { arg: "path", resource: "docs/a.md" },
    },
  };
  assert.throws(
    () =>
      evaluateSync(
        evidence,
        makeTurn("", [readCall("docs/a.md")]),
        makeContext(expect),
      ),
    /workspace|观察/,
  );
  assert.throws(
    () =>
      evaluateSync(
        workspaceEvidence(),
        workspaceTurn("", [{ ...readCall("docs/a.md"), input: { path: 42 } }]),
        makeContext(expect),
      ),
    /path|路径|观察/,
  );
  assert.throws(
    () =>
      evaluateSync(
        evidence,
        makeTurn("", [{ name: "read", input: {}, output: output("正文") }]),
        makeContext({ toolResult: { tool: "read" } }),
      ),
    /status|观察/,
  );
});

test("evidence：非法声明与未知字段在内容求值前显式拒绝", () => {
  const illegal: unknown[] = [
    null,
    {},
    { unknown: {} },
    { toolResult: { tool: "" } },
    { toolResult: { tool: "read" }, unknown: true },
    {
      toolResult: {
        tool: "read",
        path: { arg: "path", resource: "/absolute.md" },
      },
    },
    {
      toolResult: {
        tool: "read",
        path: { arg: "path", resource: "docs\\a.md" },
      },
    },
    {
      toolResult: {
        tool: "read",
        path: { arg: "path", resource: "docs//a.md" },
      },
    },
    {
      toolResult: {
        tool: "read",
        path: { arg: "path", resource: "docs/./a.md" },
      },
    },
    { toolResult: { tool: "read", path: { arg: "path", resource: ".." } } },
  ];
  for (const expect of illegal) {
    assert.throws(
      () => evaluateSync(evidence, makeTurn("", []), makeContext(expect)),
      /evidence|资源路径/,
    );
  }
});

test("evidence/not：只否定同一有效证据，回答点名、失败与空白读取不构成违规", () => {
  const expect = {
    not: {
      toolResult: {
        tool: "read",
        path: { arg: "path", resource: "docs/forbidden.md" },
      },
    },
  };
  for (const turn of [
    workspaceTurn("回答提到 docs/forbidden.md", []),
    workspaceTurn("", [readCall("docs/forbidden.md", "失败正文", "failed")]),
    workspaceTurn("", [readCall("docs/forbidden.md", "  ")]),
  ]) {
    assert.equal(
      evaluateSync(workspaceEvidence(), turn, makeContext(expect)).pass,
      true,
    );
  }
  const violation = evaluateSync(
    workspaceEvidence(),
    workspaceTurn("", [readCall("docs/forbidden.md")]),
    makeContext(expect),
  );
  assert.equal(violation.pass, false);
  assert.match(violation.reason, /docs\/forbidden\.md/);
});

test("evidence/allOf：入口与附件分别必需，reason 保留每个命名子项", () => {
  const expect = {
    allOf: [
      {
        name: "entry",
        toolResult: {
          tool: "read",
          path: { arg: "path", resource: "docs/entry.md" },
        },
      },
      {
        name: "attachment",
        toolResult: {
          tool: "read",
          path: { arg: "path", resource: "docs/attachment.md" },
        },
      },
    ],
  };
  const pass = evaluateSync(
    workspaceEvidence(),
    workspaceTurn("", [
      readCall("docs/entry.md"),
      readCall("docs/attachment.md"),
    ]),
    makeContext(expect),
  );
  assert.equal(pass.pass, true);
  assert.match(pass.reason, /entry.*pass|pass.*entry/);
  assert.match(pass.reason, /attachment.*pass|pass.*attachment/);

  const fail = evaluateSync(
    workspaceEvidence(),
    workspaceTurn("", [readCall("docs/entry.md")]),
    makeContext(expect),
  );
  assert.equal(fail.pass, false);
  assert.match(fail.reason, /entry/);
  assert.match(fail.reason, /attachment/);
  assert.match(fail.reason, /docs\/attachment\.md/);
});

test("evidence/allOf：多个禁止项任一命中即失败并定位违规资源", () => {
  const expect = {
    allOf: [
      {
        name: "forbid-a",
        not: {
          toolResult: {
            tool: "read",
            path: { arg: "path", resource: "docs/a.md" },
          },
        },
      },
      {
        name: "forbid-b",
        not: {
          toolResult: {
            tool: "read",
            path: { arg: "path", resource: "docs/b.md" },
          },
        },
      },
    ],
  };
  const result = evaluateSync(
    workspaceEvidence(),
    workspaceTurn("", [readCall("docs/b.md")]),
    makeContext(expect),
  );
  assert.equal(result.pass, false);
  assert.match(result.reason, /forbid-b/);
  assert.match(result.reason, /docs\/b\.md/);
});

test("evidence：非法组合、空清单和重复子项名显式拒绝", () => {
  const validChild = { name: "read", toolResult: { tool: "read" } };
  const illegal: unknown[] = [
    { allOf: [] },
    { allOf: [{ toolResult: { tool: "read" } }] },
    { allOf: [validChild, validChild] },
    { allOf: [validChild, { name: "bad", unknown: {} }] },
    { not: { unknown: {} } },
  ];
  for (const expect of illegal) {
    assert.throws(
      () => evaluateSync(evidence, makeTurn("", []), makeContext(expect)),
      /evidence|allOf|not/,
    );
  }
});

test("evidence：组合不吞观察错误，未求值分支也不能隐藏非法声明", () => {
  const missingWorkspace = {
    allOf: [
      { name: "missing", toolResult: { tool: "read" } },
      {
        name: "path",
        toolResult: {
          tool: "read",
          path: { arg: "path", resource: "docs/a.md" },
        },
      },
    ],
  };
  assert.throws(
    () =>
      evaluateSync(evidence, makeTurn("", []), makeContext(missingWorkspace)),
    /workspace|观察/,
  );
  assert.throws(
    () =>
      evaluateSync(
        evidence,
        makeTurn("", []),
        makeContext({
          allOf: [
            { name: "missing", toolResult: { tool: "read" } },
            { name: "bad", toolResult: { tool: "read", unknown: true } },
          ],
        }),
      ),
    /unknown|未知字段/,
  );
});
