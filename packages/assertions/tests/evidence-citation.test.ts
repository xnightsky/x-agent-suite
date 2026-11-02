/**
 * @module @x-agent-suite/assertions/tests/evidence-citation
 * 引用必须关联同一路径成功非空阅读的公开契约测试。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { evidence } from "../src/index.ts";
import { evaluateSync, makeContext } from "./support.ts";
import {
  readCall,
  workspaceEvidence,
  workspaceTurn,
} from "./evidence-support.ts";

function citation(path: string, contains?: readonly string[]) {
  return {
    citation: {
      tool: "read",
      pathArg: "path",
      path,
      ...(contains ? { contains } : {}),
    },
  };
}

test("evidence/citation：回答引用与内部绝对路径实读可按同一逻辑资源关联", () => {
  const result = evaluateSync(
    workspaceEvidence(),
    workspaceTurn("依据 docs/research.md", [
      readCall("/sandbox/root/docs/research.md"),
    ]),
    makeContext(citation("docs/research.md")),
  );
  assert.equal(result.pass, true);
  assert.equal(result.score, 1);
});

test("evidence/citation：只有引用、只有读取、失败或空白读取均不通过", () => {
  for (const turn of [
    workspaceTurn("依据 docs/research.md", []),
    workspaceTurn("没有引用", [readCall("docs/research.md")]),
    workspaceTurn("依据 docs/research.md", [
      readCall("docs/research.md", "失败正文", "failed"),
    ]),
    workspaceTurn("依据 docs/research.md", [
      readCall("docs/research.md", "  "),
    ]),
  ]) {
    const result = evaluateSync(
      workspaceEvidence(),
      turn,
      makeContext(citation("docs/research.md")),
    );
    assert.equal(result.pass, false);
    assert.match(result.reason, /docs\/research\.md/);
  }
});

test("evidence/citation：contains 聚合同一路径多次成功读取并按声明核对全部片段", () => {
  const expect = citation("docs/research.md", ["提取关键词", "完成标准"]);
  const pass = evaluateSync(
    workspaceEvidence(),
    workspaceTurn("依据 docs/research.md", [
      readCall("docs/research.md", "提取关键词"),
      readCall("./docs/research.md", "完成标准"),
    ]),
    makeContext(expect),
  );
  assert.equal(pass.pass, true);

  const missing = evaluateSync(
    workspaceEvidence(),
    workspaceTurn("依据 docs/research.md", [
      readCall("docs/research.md", "提取关键词"),
      readCall("docs/research.md", "其他内容"),
    ]),
    makeContext(expect),
  );
  assert.equal(missing.pass, false);
  assert.match(missing.reason, /完成标准/);
});

test("evidence/citation：不同路径不混合，失败与空白读取不贡献 contains 证据", () => {
  const expect = citation("docs/a.md", ["第一片段", "第二片段"]);
  for (const calls of [
    [readCall("docs/a.md", "第一片段"), readCall("docs/b.md", "第二片段")],
    [
      readCall("docs/a.md", "第一片段"),
      readCall("docs/a.md", "第二片段", "failed"),
    ],
    [readCall("docs/a.md", "第一片段"), readCall("docs/a.md", "  ")],
  ]) {
    const result = evaluateSync(
      workspaceEvidence(),
      workspaceTurn("依据 docs/a.md", calls),
      makeContext(expect),
    );
    assert.equal(result.pass, false);
  }
});

test("evidence/citation：多个引用任一缺失时 allOf 诊断定位具体路径", () => {
  const result = evaluateSync(
    workspaceEvidence(),
    workspaceTurn("依据 docs/a.md 与 docs/b.md", [readCall("docs/a.md")]),
    makeContext({
      allOf: [
        { name: "cite-a", ...citation("docs/a.md") },
        { name: "cite-b", ...citation("docs/b.md") },
      ],
    }),
  );
  assert.equal(result.pass, false);
  assert.match(result.reason, /cite-b/);
  assert.match(result.reason, /docs\/b\.md/);
});

test("evidence/citation：v1 明确保留普通 includes 的前缀后缀限制", () => {
  const result = evaluateSync(
    workspaceEvidence(),
    workspaceTurn("文本 docs/a.md.bak 仍包含声明路径", [readCall("docs/a.md")]),
    makeContext(citation("docs/a.md")),
  );
  assert.equal(result.pass, true);
});

test("evidence/citation：非法声明与未知字段显式拒绝", () => {
  const illegal: unknown[] = [
    { citation: null },
    { citation: { tool: "read", path: "docs/a.md" } },
    { citation: { tool: "read", pathArg: "path" } },
    { citation: { tool: "read", pathArg: "path", path: "/docs/a.md" } },
    {
      citation: {
        tool: "read",
        pathArg: "path",
        path: "docs/a.md",
        contains: [],
      },
    },
    {
      citation: {
        tool: "read",
        pathArg: "path",
        path: "docs/a.md",
        unknown: true,
      },
    },
  ];
  for (const expect of illegal) {
    assert.throws(
      () => evaluateSync(evidence, workspaceTurn("", []), makeContext(expect)),
      /evidence|citation|资源路径/,
    );
  }
});

test("evidence/allOf：检索、实读、引用完整成立或逐项指出缺失环节", () => {
  const expect = {
    allOf: [
      {
        name: "search",
        toolResult: {
          tool: "grep",
          args: { query: "研究流程" },
          contains: ["docs/research.md"],
        },
      },
      {
        name: "read",
        toolResult: {
          tool: "read",
          path: { arg: "path", resource: "docs/research.md" },
        },
      },
      { name: "cite", ...citation("docs/research.md") },
    ],
  };
  const searchCall = {
    name: "grep",
    input: { query: "研究流程" },
    output: { content: [{ type: "text", text: "docs/research.md" }] },
    status: "completed" as const,
  };
  const pass = evaluateSync(
    workspaceEvidence(),
    workspaceTurn("依据 docs/research.md", [
      searchCall,
      readCall("docs/research.md"),
    ]),
    makeContext(expect),
  );
  assert.equal(pass.pass, true);

  for (const [text, calls, missing] of [
    ["依据 docs/research.md", [readCall("docs/research.md")], /search/],
    ["依据 docs/research.md", [searchCall], /cite|read/],
    ["没有引用", [searchCall, readCall("docs/research.md")], /cite/],
  ] as const) {
    const result = evaluateSync(
      workspaceEvidence(),
      workspaceTurn(text, [...calls]),
      makeContext(expect),
    );
    assert.equal(result.pass, false);
    assert.match(result.reason, missing);
  }
});
