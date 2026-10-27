/**
 * @module @x-agent-suite/recall/tests/compile
 * YAML 严格校验与 ScenarioSpec 编译；所有错误发生在 driver 创建之前。
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { textContains } from "@x-agent-suite/criteria";
import { compileRecallFile } from "../src/compile.ts";

const criteria = [textContains];

async function compileYaml(
  yaml: string,
  setup?: (root: string) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "xas-recall-compile-"));
  const file = join(root, "suite.yaml");
  await writeFile(file, yaml);
  if (setup) await setup(root);
  try {
    return await compileRecallFile(file, { rootDir: root, criteria });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("单轮、多轮、超时、metadata 与 context provision 正确映射", async () => {
  const scenarios = await compileYaml(
    `version: 1
id: project-rules
context:
  files:
    - AGENTS.md
cases:
  - id: one
    timeoutMs: 12000
    metadata:
      source: AGENTS.md#rule
    turns:
      - send: first input
        timeoutMs: 3000
        expect:
          text-contains: [first]
  - id: two
    turns:
      - send: second input
      - send: third input
        expect:
          text-contains: third
`,
    async (root) => writeFile(join(root, "AGENTS.md"), "read only"),
  );
  assert.equal(scenarios.length, 2);
  const recallMetadata = scenarios[0]!.metadata!.recall as { file: string };
  assert.deepEqual(scenarios[0], {
    id: "project-rules/one",
    turns: [
      {
        send: "first input",
        timeoutMs: 3000,
        expect: { "text-contains": ["first"] },
      },
    ],
    timeoutMs: 12000,
    provision: {
      context: {
        files: [{ path: "AGENTS.md", content: "read only" }],
      },
    },
    metadata: {
      source: "AGENTS.md#rule",
      recall: {
        fileId: "project-rules",
        caseId: "one",
        file: recallMetadata.file,
      },
    },
  });
  assert.match(recallMetadata.file, /suite.yaml$/);
  assert.equal(scenarios[1]!.id, "project-rules/two");
  assert.equal(scenarios[1]!.turns.length, 2);
  assert.equal(scenarios[1]!.timeoutMs, undefined);
});

test("version、空定义、未知字段和非法 timeout 全部拒绝", async (t) => {
  const cases = [
    ["version: 2\nid: x\ncases: []\n", /version/],
    ["version: 1\nid: x\nunknown: true\ncases: []\n", /unknown|未知字段/],
    ["version: 1\nid: x\ncases: []\n", /cases|考卷/],
    ["version: 1\nid: x\ncases:\n  - id: c\n    turns: []\n", /turns|轮次/],
    [
      "version: 1\nid: x\ncases:\n  - id: c\n    turns:\n      - send: ''\n",
      /send/,
    ],
    [
      "version: 1\nid: x\ncases:\n  - id: c\n    timeoutMs: 0\n    turns:\n      - send: x\n",
      /timeoutMs/,
    ],
    [
      "version: 1\nid: x\ncases:\n  - id: c\n    turns:\n      - send: x\n        timeoutMs: 1.5\n",
      /timeoutMs/,
    ],
    ["version: [\n", /YAML|yaml|解析/],
  ] as const;
  for (const [yaml, expected] of cases) {
    await t.test(expected.source, async () => {
      await assert.rejects(compileYaml(yaml), expected);
    });
  }
});

test("未注册 turn metric 在编译阶段失败", async () => {
  await assert.rejects(
    compileYaml(`version: 1
id: x
cases:
  - id: c
    turns:
      - send: hello
        expect:
          missing-metric: [x]
`),
    /missing-metric.*未注册|未注册.*missing-metric/,
  );
});

test("context 文件缺失、绝对路径、目录逃逸和符号链接逃逸均失败", async (t) => {
  const yaml = (path: string) => `version: 1
id: x
context:
  files: [${JSON.stringify(path)}]
cases:
  - id: c
    turns:
      - send: hello
`;
  for (const path of ["missing.md", "../outside.md", "/tmp/outside.md"]) {
    await t.test(path, async () => {
      await assert.rejects(compileYaml(yaml(path)), /context|路径|文件/);
    });
  }
  await t.test("symbolic link", async () => {
    const root = await mkdtemp(join(tmpdir(), "xas-recall-link-"));
    const outside = join(root, "outside.md");
    const workspace = join(root, "workspace");
    await mkdir(workspace);
    await writeFile(outside, "outside");
    await writeFile(join(workspace, "suite.yaml"), yaml("linked.md"));
    const { symlink } = await import("node:fs/promises");
    await symlink(outside, join(workspace, "linked.md"));
    try {
      await assert.rejects(
        compileRecallFile(join(workspace, "suite.yaml"), {
          rootDir: workspace,
          criteria,
        }),
        /逃逸|路径/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
