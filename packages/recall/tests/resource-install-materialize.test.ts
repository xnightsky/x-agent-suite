/**
 * @module @x-agent-suite/recall/tests/resource-install-materialize
 * 安装开关与隔离资源现场；只验证目录复制，不执行外部安装器。
 */
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { cleanupSandbox, createSandbox } from "@x-agent-suite/sandbox";
import { readContextFiles } from "../src/context.ts";
import {
  materializeRecallProvision,
  readRecallResources,
} from "../src/resources.ts";

async function workspace(t: TestContext) {
  const sourceRoot = await realpath(
    await mkdtemp(join(tmpdir(), "xas-install-")),
  );
  const sandbox = await createSandbox();
  t.after(async () => {
    await cleanupSandbox(sandbox);
    await rm(sourceRoot, { recursive: true, force: true });
  });
  return { sourceRoot, sandbox };
}

test("显式安装完整目录到不同项目位置，来源和隔离 HOME 不变", async (t) => {
  const { sourceRoot, sandbox } = await workspace(t);
  await mkdir(join(sourceRoot, "bundle", "scripts"), { recursive: true });
  const source = join(sourceRoot, "bundle", "scripts", "entry.txt");
  await writeFile(source, "resource payload");
  const sourceMode = (await stat(source)).mode;
  const resources = await readRecallResources(
    [
      {
        source: "bundle",
        install: true,
        destination: "resources/bundle",
        kind: "directory",
        readOnly: true,
      },
      {
        source: "bundle",
        install: true,
        destination: "alternate/bundle",
        kind: "directory",
        readOnly: true,
      },
    ],
    sourceRoot,
    "suite.yaml",
  );
  await materializeRecallProvision(sandbox, { plan: "installed", resources });
  for (const destination of ["resources/bundle", "alternate/bundle"]) {
    const file = join(sandbox.cwd, destination, "scripts", "entry.txt");
    assert.equal(await readFile(file, "utf8"), "resource payload");
    if (process.platform !== "win32")
      assert.equal((await stat(file)).mode & 0o777, 0o444);
  }
  assert.equal(await readFile(source, "utf8"), "resource payload");
  assert.equal((await stat(source)).mode, sourceMode);
  assert.deepEqual(await readdir(sourceRoot), ["bundle"]);
  assert.deepEqual(await readdir(sandbox.homeDir), []);
});

test("禁用资源无需 destination 或可读取的来源，物化不创建文件", async (t) => {
  const { sourceRoot, sandbox } = await workspace(t);
  await materializeRecallProvision(sandbox, {
    plan: "absent",
    resources: [{ source: join(sourceRoot, "missing"), install: false }],
  });
  assert.deepEqual(await readdir(sandbox.cwd), []);
  assert.deepEqual(await readdir(sandbox.homeDir), []);
});

test("直接传入禁用资源与 destination 的组合时明确拒绝", async (t) => {
  const { sourceRoot, sandbox } = await workspace(t);
  for (const destination of ["output", null, undefined]) {
    await assert.rejects(
      () =>
        materializeRecallProvision(sandbox, {
          plan: "invalid",
          resources: [
            {
              source: join(sourceRoot, "missing"),
              install: false,
              destination,
            },
          ],
        }),
      /install.*destination|destination.*install/,
    );
  }
  assert.deepEqual(await readdir(sandbox.cwd), []);
});

test("直接传入非布尔 install 时明确拒绝", async (t) => {
  const { sourceRoot, sandbox } = await workspace(t);
  for (const install of ["false", null, 0]) {
    await assert.rejects(
      () =>
        materializeRecallProvision(sandbox, {
          plan: "invalid",
          resources: [
            {
              source: join(sourceRoot, "missing"),
              install,
              destination: "output",
            },
          ],
        }),
      /install.*布尔/,
    );
  }
});

test("直接传入主目录简写目标时拒绝，不在工作区创建伪主目录", async (t) => {
  const { sourceRoot, sandbox } = await workspace(t);
  const source = join(sourceRoot, "input.txt");
  await writeFile(source, "payload");
  for (const destination of [
    "~",
    "~/global",
    "~/../global",
    "~\\global",
    "~\\..\\global",
    "local/../~/global",
  ]) {
    await assert.rejects(
      () =>
        materializeRecallProvision(sandbox, {
          plan: "invalid",
          resources: [{ source, destination, kind: "file", readOnly: true }],
        }),
      /destination/,
    );
  }
  assert.deepEqual(await readdir(sandbox.cwd), []);
});

test(
  "context.files 保留普通波浪号目录与 POSIX 反斜杠文件名",
  {
    skip: process.platform === "win32",
  },
  async (t) => {
    const { sourceRoot, sandbox } = await workspace(t);
    const paths = ["fixtures/a\\b.txt", "~/entry.txt"];
    await mkdir(join(sourceRoot, "fixtures"));
    await mkdir(join(sourceRoot, "~"));
    for (const path of paths)
      await writeFile(join(sourceRoot, path), "context");
    const files = await readContextFiles(paths, sourceRoot);
    await materializeRecallProvision(sandbox, { context: { files } });
    for (const path of paths) {
      assert.equal(await readFile(join(sandbox.cwd, path), "utf8"), "context");
    }
    await assert.rejects(stat(join(sandbox.cwd, "fixtures/a/b.txt")), {
      code: "ENOENT",
    });
  },
);

test("省略 install 的旧资源照常安装，新现场切换到禁用计划无残留", async (t) => {
  const { sourceRoot, sandbox } = await workspace(t);
  await writeFile(join(sourceRoot, "input.txt"), "payload");
  const resources = await readRecallResources(
    [
      {
        source: "input.txt",
        destination: "input.txt",
        kind: "file",
        readOnly: true,
      },
    ],
    sourceRoot,
    "suite.yaml",
  );
  await materializeRecallProvision(sandbox, { plan: "installed", resources });
  assert.equal(
    await readFile(join(sandbox.cwd, "input.txt"), "utf8"),
    "payload",
  );
  const absentSandbox = await createSandbox();
  t.after(() => cleanupSandbox(absentSandbox));
  const disabled = await readRecallResources(
    [{ source: "input.txt", install: false, kind: "file", readOnly: true }],
    sourceRoot,
    "suite.yaml",
  );
  await materializeRecallProvision(absentSandbox, {
    plan: "absent",
    resources: disabled,
  });
  assert.deepEqual(await readdir(absentSandbox.cwd), []);
  assert.deepEqual(await readdir(absentSandbox.homeDir), []);
});
