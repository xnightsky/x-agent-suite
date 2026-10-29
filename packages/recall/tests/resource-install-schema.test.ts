/**
 * @module @x-agent-suite/recall/tests/resource-install-schema
 * 资源安装开关的声明约束与编译过滤；全部使用临时文件，不启动宿主。
 */
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileRecallFile } from "../src/compile.ts";
import { parseRecallYaml } from "../src/schema.ts";

function document(resources: readonly unknown[]): string {
  return JSON.stringify({
    version: 1,
    id: "resource-install",
    plans: { local: { resources } },
    context: { plan: "local" },
    cases: [{ id: "run", turns: [{ send: "inspect resources" }] }],
  });
}

function parseResources(resources: readonly unknown[]) {
  return parseRecallYaml(document(resources), "suite.yaml").plans!.local!
    .resources;
}

test("禁用安装的声明不要求 destination", () => {
  assert.deepEqual(parseResources([{ source: "missing", install: false }]), [
    { source: "missing", install: false, kind: "file", readOnly: true },
  ]);
});

test("显式启用与省略开关保持旧声明的默认类别和只读规则", () => {
  const base = { source: "input.txt", destination: "inputs/input.txt" };
  assert.deepEqual(parseResources([base]), [
    { ...base, kind: "file", readOnly: true },
  ]);
  assert.deepEqual(parseResources([{ ...base, install: true }]), [
    { ...base, install: true, kind: "file", readOnly: true },
  ]);
});

test("禁用安装时任何 destination 字段都拒绝，包括空值", () => {
  for (const destination of ["output", "", null, false]) {
    assert.throws(
      () =>
        parseResources([{ source: "missing", install: false, destination }]),
      /install.*destination|destination.*install/,
    );
  }
});

test("显式启用和省略开关都要求 destination", () => {
  for (const install of [true, undefined]) {
    assert.throws(
      () => parseResources([{ source: "input.txt", install }]),
      /destination/,
    );
  }
});

test("install 只接受布尔值", () => {
  for (const install of [null, "false", 0, [], {}]) {
    assert.throws(
      () =>
        parseResources([{ source: "input", destination: "output", install }]),
      /install.*布尔/,
    );
  }
});

test("禁用项仍校验来源字符串、类别和只读字段", () => {
  for (const [fields, message] of [
    [{ source: "" }, /source/],
    [{ kind: "unsupported" }, /kind/],
    [{ readOnly: false }, /readOnly/],
    [{ extra: true }, /未知字段/],
  ] as const) {
    assert.throws(
      () => parseResources([{ source: "missing", install: false, ...fields }]),
      message,
    );
  }
});

test("启用资源拒绝主目录简写、绝对目标与逃逸目标", () => {
  for (const destination of [
    "~",
    "~/global",
    "~/../global",
    "~\\global",
    "~\\..\\global",
    "local/../~/global",
    "/outside",
    "C:\\outside",
    "../outside",
  ]) {
    assert.throws(
      () => parseResources([{ source: "input", destination }]),
      /destination/,
    );
  }
});

test("禁用项不参与目标冲突，启用项仍拒绝前缀冲突", () => {
  const active = {
    source: "bundle",
    destination: "resources",
    kind: "directory",
  };
  assert.equal(
    parseResources([{ source: "bundle", install: false }, active]).length,
    2,
  );
  assert.throws(
    () =>
      parseResources([active, { source: "other", destination: "resources/x" }]),
    /冲突/,
  );
});

test("编译过滤不存在或无法解析的禁用来源，只保留启用资源", async (t) => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "xas-install-schema-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "input.txt"), "payload");
  const file = join(root, "suite.yaml");
  await writeFile(
    file,
    document([
      { source: "missing", install: false, kind: "directory" },
      { source: "input.txt", destination: "inputs/input.txt", install: true },
    ]),
  );
  const [scenario] = await compileRecallFile(file, {
    rootDir: root,
    criteria: [],
  });
  assert.deepEqual(scenario!.provision, {
    plan: "local",
    resources: [
      {
        source: join(root, "input.txt"),
        destination: "inputs/input.txt",
        install: true,
        kind: "file",
        readOnly: true,
      },
    ],
  });
  await writeFile(file, document([{ source: "missing", install: false }]));
  const [absent] = await compileRecallFile(file, {
    rootDir: root,
    criteria: [],
  });
  assert.deepEqual(absent!.provision, { plan: "local", resources: [] });
  await writeFile(
    file,
    document([{ source: "missing", destination: "output" }]),
  );
  await assert.rejects(
    () => compileRecallFile(file, { rootDir: root, criteria: [] }),
    /source.*缺失|source.*不存在/,
  );
});
