/**
 * @module @x-agent-suite/recall/tests/compile
 * Recall YAML、文件内 plans/context.plan 与 ScenarioSpec.provision 编译测试。
 */
import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { textContains } from "@x-agent-suite/criteria";
import { cleanupSandbox, createSandbox } from "@x-agent-suite/sandbox";
import { compileRecallFile } from "../src/compile.ts";
import { materializeRecallProvision } from "../src/resources.ts";

const criteria = [textContains];

async function workspace(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "xas-recall-compile-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function compileYaml(
  t: TestContext,
  yaml: string,
  setup?: (root: string) => Promise<void>,
) {
  const root = await workspace(t);
  const file = join(root, "suite.yaml");
  await writeFile(file, yaml);
  if (setup) await setup(root);
  return compileRecallFile(file, { rootDir: root, criteria });
}

test("单轮、多轮、timeout、metadata 与 context.files 显式编译", async (t) => {
  const scenarios = await compileYaml(
    t,
    `version: 1
id: project-rules
context:
  files: [AGENTS.md]
cases:
  - id: one
    timeoutMs: 12000
    metadata: { source: AGENTS.md#rule }
    turns:
      - send: first input
        timeoutMs: 3000
        expect: { text-contains: [first] }
  - id: two
    turns:
      - send: second input
      - send: third input
        expect: { text-contains: [third] }
`,
    async (root) => writeFile(join(root, "AGENTS.md"), "read only"),
  );
  assert.equal(scenarios.length, 2);
  const first = scenarios[0]!;
  assert.equal(first.id, "project-rules/one");
  assert.equal(first.timeoutMs, 12000);
  assert.deepEqual(first.turns, [
    {
      send: "first input",
      timeoutMs: 3000,
      expect: { "text-contains": ["first"] },
    },
  ]);
  assert.deepEqual(first.provision, {
    context: { files: [{ path: "AGENTS.md", content: "read only" }] },
  });
  const metadata = first.metadata!.recall as Record<string, unknown>;
  assert.equal(metadata.fileId, "project-rules");
  assert.equal(metadata.caseId, "one");
  assert.equal(metadata.provision, "files");
  assert.match(String(metadata.file), /suite.yaml$/);
  assert.deepEqual(scenarios[1]!.provision, first.provision);
  assert.equal(scenarios[1]!.turns.length, 2);
});

test("文件内 plans 全局继承、case 整块覆盖、none 清空与 files 替换", async (t) => {
  const scenarios = await compileYaml(
    t,
    `version: 1
id: resources
plans:
  shared:
    resources:
      - source: resources
        destination: mounted
        kind: directory
  single:
    resources:
      - source: single.txt
        destination: docs/single.txt
context:
  plan: shared
cases:
  - id: inherit
    turns: [{ send: inherit }]
  - id: override
    context: { plan: single }
    turns: [{ send: override }]
  - id: clear
    context: { plan: none }
    turns: [{ send: clear }]
  - id: files
    context: { files: [context.txt] }
    turns: [{ send: files }]
`,
    async (root) => {
      await mkdir(join(root, "resources"), { recursive: true });
      await writeFile(join(root, "resources", "inside.txt"), "inside");
      await writeFile(join(root, "single.txt"), "single");
      await writeFile(join(root, "context.txt"), "context");
    },
  );
  const [inherited, overridden, cleared, files] = scenarios;
  const root = await realpath(
    join(String((inherited!.metadata!.recall as { file: string }).file), ".."),
  );
  assert.deepEqual(inherited!.provision, {
    plan: "shared",
    resources: [
      {
        source: await realpath(join(root, "resources")),
        destination: "mounted",
        kind: "directory",
        readOnly: true,
      },
    ],
  });
  assert.equal(
    (inherited!.metadata!.recall as { provision: string }).provision,
    "plan:shared",
  );
  assert.deepEqual(overridden!.provision, {
    plan: "single",
    resources: [
      {
        source: await realpath(join(root, "single.txt")),
        destination: "docs/single.txt",
        kind: "file",
        readOnly: true,
      },
    ],
  });
  assert.equal(cleared!.provision, undefined);
  assert.equal(
    (cleared!.metadata!.recall as { provision: string }).provision,
    "none",
  );
  assert.deepEqual(files!.provision, {
    context: { files: [{ path: "context.txt", content: "context" }] },
  });
  assert.equal(
    (overridden!.metadata!.recall as { provision: string }).provision,
    "plan:single",
  );
});

test("plans/context.plan 未注册、跨文件引用、互斥和 destination 冲突均前置失败", async (t) => {
  const invalid = [
    [
      `version: 1
id: x
plans:
  none: { resources: [] }
cases: [{ id: c, turns: [{ send: x }] }]
`,
      /none|覆盖/,
    ],
    [
      `version: 1
id: x
context: { plan: shared, files: [x.txt] }
cases: [{ id: c, turns: [{ send: x }] }]
`,
      /互斥/,
    ],
    [
      `version: 1
id: x
plans:
  shared:
    resources: [{ source: x.txt, destination: x.txt }]
context: { plan: missing }
cases: [{ id: c, turns: [{ send: x }] }]
`,
      /未注册.*missing|missing.*未注册/,
    ],
    [
      `version: 1
id: x
plans:
  shared:
    resources:
      - { source: x.txt, destination: same.txt }
      - { source: x.txt, destination: same.txt }
cases: [{ id: c, turns: [{ send: x }] }]
`,
      /冲突/,
    ],
    [
      `version: 1
id: x
plans:
  shared:
    resources:
      - { source: x.txt, destination: mounted }
      - { source: x.txt, destination: mounted/inside.txt }
cases: [{ id: c, turns: [{ send: x }] }]
`,
      /冲突/,
    ],
    [
      `version: 1
id: x
plans:
  shared:
    resources: [{ source: x.txt, destination: x.txt, readOnly: false }]
cases: [{ id: c, turns: [{ send: x }] }]
`,
      /readOnly/,
    ],
  ] as const;
  for (const [yaml, expected] of invalid) {
    await assert.rejects(compileYaml(t, yaml), expected);
  }
  await assert.rejects(
    compileYaml(
      t,
      `version: 1
id: cross-file
context: { plan: shared }
cases: [{ id: c, turns: [{ send: x }] }]
`,
    ),
    /未注册.*shared|shared.*未注册/,
  );
});

test("version、空定义、未知字段、非法 timeout 与未注册 metric 全部拒绝", async (t) => {
  const invalid = [
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
      "version: 1\nid: x\ncases:\n  - id: c\n    turns:\n      - send: x\n        expect:\n          missing-metric: [x]\n",
      /missing-metric|未注册/,
    ],
    ["version: [\n", /YAML|yaml|解析/],
  ] as const;
  for (const [yaml, expected] of invalid) {
    await assert.rejects(compileYaml(t, yaml), expected);
  }
});

test("context.files 与 plan source 的缺失、逃逸和符号链接逃逸均失败", async (t) => {
  const root = await workspace(t);
  const outside = join(root, "outside.txt");
  const workspaceRoot = join(root, "workspace");
  await mkdir(workspaceRoot);
  await writeFile(outside, "outside");
  await symlink(outside, join(workspaceRoot, "linked.txt"));
  const cases = [
    `version: 1
id: x
context: { files: [../outside.txt] }
cases: [{ id: c, turns: [{ send: x }] }]
`,
    `version: 1
id: x
context: { files: [linked.txt] }
cases: [{ id: c, turns: [{ send: x }] }]
`,
    `version: 1
id: x
plans:
  shared:
    resources: [{ source: ../outside.txt, destination: x.txt }]
context: { plan: shared }
cases: [{ id: c, turns: [{ send: x }] }]
`,
    `version: 1
id: x
plans:
  shared:
    resources: [{ source: missing.txt, destination: x.txt }]
context: { plan: shared }
cases: [{ id: c, turns: [{ send: x }] }]
`,
  ];
  for (const yaml of cases) {
    const file = join(workspaceRoot, "suite.yaml");
    await writeFile(file, yaml);
    await assert.rejects(
      compileRecallFile(file, { rootDir: workspaceRoot, criteria }),
      /逃逸|缺失|不存在|文件/,
    );
  }
});

test("ScenarioSpec.provision 物化为只读文件，finally cleanup 删除隔离现场", async (t) => {
  const scenarios = await compileYaml(
    t,
    `version: 1
id: resources
plans:
  shared:
    resources:
      - source: input.txt
        destination: nested/input.txt
context: { plan: shared }
cases: [{ id: c, turns: [{ send: x }] }]
`,
    async (root) => writeFile(join(root, "input.txt"), "read only"),
  );
  const sandbox = await createSandbox();
  const destination = join(sandbox.cwd, "nested", "input.txt");
  try {
    await materializeRecallProvision(sandbox, scenarios[0]!.provision);
    assert.equal(await readFile(destination, "utf8"), "read only");
    assert.equal((await stat(destination)).mode & 0o444, 0o444);
  } finally {
    await cleanupSandbox(sandbox);
  }
  await assert.rejects(access(destination));
});

test("工厂描述符参与 metric 注册校验：声明即可通过引用检查，缺声明仍拒绝", async (t) => {
  const root = await workspace(t);
  const file = join(root, "suite.yaml");
  await writeFile(
    file,
    `version: 1
id: mixed-registry
cases:
  - id: c
    turns:
      - send: x
        expect: { text-contains: [x], factory-metric: [{ name: q, rubric: 标准 }] }
`,
  );
  const factoryDescriptor = {
    name: "factory-metric",
    scope: "turn" as const,
    create: async () => {
      throw new Error("编译期不得调用工厂 create");
    },
  };
  const scenarios = await compileRecallFile(file, {
    rootDir: root,
    criteria: [textContains, factoryDescriptor],
  });
  assert.equal(scenarios.length, 1);
  assert.deepEqual(Object.keys(scenarios[0]!.turns[0]!.expect!), [
    "text-contains",
    "factory-metric",
  ]);

  await assert.rejects(
    compileRecallFile(file, { rootDir: root, criteria: [textContains] }),
    /factory-metric|未注册/,
  );
});
