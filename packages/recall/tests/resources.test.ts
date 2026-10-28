/**
 * @module @x-agent-suite/recall/tests/resources
 * Recall 资源物化：目标面物理锚定（祖先/叶链接、禁覆盖）与来源面链接拒绝。
 *
 * 不变量：独占来源与目标目录树时，物化仅在 sandbox.cwd 内创建条目；
 * 既有链接、既有目标与目录资源内的链接均显式拒绝。
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cleanupSandbox, createSandbox } from "@x-agent-suite/sandbox";
import {
  materializeRecallProvision,
  readRecallResources,
} from "../src/resources.ts";

/** 在 root 下写一个来源文件，返回绝对路径。 */
async function sourceFile(root: string, name = "input.txt"): Promise<string> {
  const file = join(root, name);
  await writeFile(file, "payload");
  return file;
}

/**
 * 创建 realpath 规范化后的临时根，模拟编译产物中的物理 source。
 *
 * 不用裸 mkdtemp：macOS 返回 /var 别名，会与「物理来源」契约冲突。
 */
async function tempRoot(prefix: string): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), prefix)));
}

test("destination 祖先为符号链接时拒绝，不写到沙箱外", async () => {
  const root = await tempRoot("xas-recall-dest-");
  const sandbox = await createSandbox();
  const outside = join(root, "outside");
  await mkdir(outside);
  const source = await sourceFile(root);
  await symlink(outside, join(sandbox.cwd, "redirect"), "junction");
  try {
    await assert.rejects(
      () =>
        materializeRecallProvision(sandbox, {
          plan: "p",
          resources: [
            {
              source,
              destination: "redirect/x.txt",
              kind: "file",
              readOnly: true,
            },
          ],
        }),
      /destination 父级含符号链接/,
    );
    assert.equal(
      existsSync(join(outside, "x.txt")),
      false,
      "不得在沙箱外创建文件",
    );
  } finally {
    await cleanupSandbox(sandbox);
    await rm(root, { recursive: true, force: true });
  }
});

test("context.files 经由祖先符号链接同样拒绝", async () => {
  const root = await mkdtemp(join(tmpdir(), "xas-recall-files-"));
  const sandbox = await createSandbox();
  const outside = join(root, "outside");
  await mkdir(outside);
  await symlink(outside, join(sandbox.cwd, "redirect"), "junction");
  try {
    await assert.rejects(
      () =>
        materializeRecallProvision(sandbox, {
          context: { files: [{ path: "redirect/injected.txt", content: "x" }] },
        }),
      /符号链接/,
    );
    assert.equal(
      existsSync(join(outside, "injected.txt")),
      false,
      "不得经链接写入沙箱外",
    );
  } finally {
    await cleanupSandbox(sandbox);
    await rm(root, { recursive: true, force: true });
  }
});

test("sandbox.cwd 本身被替换为符号链接时拒绝，不把链接目标当合法根", async () => {
  const root = await mkdtemp(join(tmpdir(), "xas-recall-cwd-"));
  const sandbox = await createSandbox();
  const outside = join(root, "outside");
  await mkdir(outside);
  await rm(sandbox.cwd, { recursive: true, force: true });
  await symlink(outside, sandbox.cwd, "junction");
  try {
    await assert.rejects(
      () =>
        materializeRecallProvision(sandbox, {
          context: { files: [{ path: "injected.txt", content: "x" }] },
        }),
      /符号链接/,
    );
    assert.equal(
      existsSync(join(outside, "injected.txt")),
      false,
      "不得把链接目标当作沙箱根写入",
    );
  } finally {
    await cleanupSandbox(sandbox);
    await rm(root, { recursive: true, force: true });
  }
});

test("目标叶节点已存在时显式拒绝，不依赖 cp 系统错误", async () => {
  const root = await tempRoot("xas-recall-leaf-");
  const sandbox = await createSandbox();
  const sourceDir = join(root, "assets");
  await mkdir(sourceDir);
  await writeFile(join(sourceDir, "new.txt"), "new");
  await mkdir(join(sandbox.cwd, "pkg"), { recursive: true });
  await writeFile(join(sandbox.cwd, "pkg", "keep.txt"), "keep");
  const source = await sourceFile(root);
  try {
    await assert.rejects(
      () =>
        materializeRecallProvision(sandbox, {
          plan: "p",
          resources: [
            {
              source: sourceDir,
              destination: "pkg",
              kind: "directory",
              readOnly: true,
            },
          ],
        }),
      /禁止覆盖/,
    );
    assert.equal(
      await readFile(join(sandbox.cwd, "pkg", "keep.txt"), "utf8"),
      "keep",
      "既有目录内容不得被合并覆盖",
    );
    await assert.rejects(
      () =>
        materializeRecallProvision(sandbox, {
          context: { files: [{ path: "pkg/keep.txt", content: "x" }] },
        }),
      /已存在|禁止覆盖/,
    );
    await assert.rejects(
      () =>
        materializeRecallProvision(sandbox, {
          plan: "p",
          resources: [
            {
              source,
              destination: "pkg/keep.txt",
              kind: "file",
              readOnly: true,
            },
          ],
        }),
      /禁止覆盖/,
    );
  } finally {
    await cleanupSandbox(sandbox);
    await rm(root, { recursive: true, force: true });
  }
});

test("目标叶节点是符号链接时拒绝，链接目标不被改写", async () => {
  const root = await mkdtemp(join(tmpdir(), "xas-recall-leaf-link-"));
  const sandbox = await createSandbox();
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "original");
  await symlink(sentinel, join(sandbox.cwd, "leaf.txt"));
  try {
    await assert.rejects(
      () =>
        materializeRecallProvision(sandbox, {
          context: { files: [{ path: "leaf.txt", content: "x" }] },
        }),
      /符号链接/,
    );
    assert.equal(await readFile(sentinel, "utf8"), "original");
  } finally {
    await cleanupSandbox(sandbox);
    await rm(root, { recursive: true, force: true });
  }
});

test("目录资源正常物化为只读实体，沙箱内不留符号链接", async () => {
  const root = await tempRoot("xas-recall-ok-");
  const sandbox = await createSandbox();
  const sourceDir = join(root, "assets");
  await mkdir(join(sourceDir, "nested"), { recursive: true });
  await writeFile(join(sourceDir, "nested", "a.txt"), "a");
  try {
    await materializeRecallProvision(sandbox, {
      plan: "p",
      resources: [
        {
          source: sourceDir,
          destination: "pkg",
          kind: "directory",
          readOnly: true,
        },
      ],
    });
    const written = join(sandbox.cwd, "pkg", "nested", "a.txt");
    assert.equal(await readFile(written, "utf8"), "a");
    assert.equal((await stat(written)).mode & 0o222, 0);
    if (process.platform !== "win32") {
      assert.equal((await stat(written)).mode & 0o777, 0o444);
      assert.equal((await stat(join(sandbox.cwd, "pkg"))).mode & 0o777, 0o555);
    }
    assert.equal((await lstat(written)).isSymbolicLink(), false);
  } finally {
    await cleanupSandbox(sandbox);
    await rm(root, { recursive: true, force: true });
  }
});

test("目录资源内的符号链接一律拒绝，不 chmod 链接目标", async () => {
  const root = await tempRoot("xas-recall-src-link-");
  const sandbox = await createSandbox();
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "host");
  await chmod(sentinel, 0o600);
  const sentinelMode = (await stat(sentinel)).mode & 0o777;
  const assets = join(root, "assets");
  await mkdir(assets);
  await writeFile(join(assets, "a.txt"), "a");
  await symlink(sentinel, join(assets, "escape.txt"));
  try {
    await assert.rejects(
      () =>
        readRecallResources(
          [
            {
              source: "assets",
              destination: "pkg",
              kind: "directory",
              readOnly: true,
            },
          ],
          root,
          "suite.yaml",
        ),
      /符号链接/,
    );
    await assert.rejects(
      () =>
        materializeRecallProvision(sandbox, {
          plan: "p",
          resources: [
            {
              source: assets,
              destination: "pkg",
              kind: "directory",
              readOnly: true,
            },
          ],
        }),
      /符号链接/,
    );
    assert.equal(
      (await stat(sentinel)).mode & 0o777,
      sentinelMode,
      "链接目标权限不得被 chmod",
    );
    assert.equal(await readFile(sentinel, "utf8"), "host");
  } finally {
    await cleanupSandbox(sandbox);
    await rm(root, { recursive: true, force: true });
  }
});

test("root 内指向同树的符号链接同样显式拒绝", async () => {
  const root = await mkdtemp(join(tmpdir(), "xas-recall-src-inner-"));
  const assets = join(root, "assets");
  await mkdir(assets);
  await writeFile(join(assets, "real.txt"), "real");
  await symlink(join(assets, "real.txt"), join(assets, "link.txt"));
  try {
    await assert.rejects(
      () =>
        readRecallResources(
          [
            {
              source: "assets",
              destination: "pkg",
              kind: "directory",
              readOnly: true,
            },
          ],
          root,
          "suite.yaml",
        ),
      /不支持符号链接/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("顶层 source 是 root 内链接时保留既有 realpath 语义", async () => {
  const root = await mkdtemp(join(tmpdir(), "xas-recall-src-top-"));
  const sandbox = await createSandbox();
  const real = join(root, "real", "assets");
  await mkdir(real, { recursive: true });
  await writeFile(join(real, "a.txt"), "a");
  await symlink(real, join(root, "linked"), "junction");
  try {
    const compiled = await readRecallResources(
      [
        {
          source: "linked",
          destination: "pkg",
          kind: "directory",
          readOnly: true,
        },
      ],
      root,
      "suite.yaml",
    );
    await materializeRecallProvision(sandbox, {
      plan: "p",
      resources: compiled,
    });
    const written = join(sandbox.cwd, "pkg", "a.txt");
    assert.equal(await readFile(written, "utf8"), "a");
    assert.equal((await lstat(written)).isSymbolicLink(), false);
  } finally {
    await cleanupSandbox(sandbox);
    await rm(root, { recursive: true, force: true });
  }
});

test("编译后来源祖先被替换为符号链接时拒绝物化", async () => {
  const root = await mkdtemp(join(tmpdir(), "xas-recall-src-ancestor-"));
  const sandbox = await createSandbox();
  const assets = join(root, "pkg", "assets");
  await mkdir(assets, { recursive: true });
  await writeFile(join(assets, "a.txt"), "a");
  const compiled = await readRecallResources(
    [
      {
        source: "pkg/assets",
        destination: "pkg",
        kind: "directory",
        readOnly: true,
      },
    ],
    root,
    "suite.yaml",
  );
  const outsidePkg = join(root, "outside-pkg");
  await mkdir(join(outsidePkg, "assets"), { recursive: true });
  await writeFile(join(outsidePkg, "assets", "evil.txt"), "evil");
  await rename(join(root, "pkg"), join(root, "pkg-real"));
  await symlink(outsidePkg, join(root, "pkg"), "junction");
  try {
    await assert.rejects(
      () =>
        materializeRecallProvision(sandbox, {
          plan: "p",
          resources: compiled,
        }),
      /符号链接/,
    );
    assert.equal(
      existsSync(join(sandbox.cwd, "pkg", "evil.txt")),
      false,
      "不得把被替换祖先下的 evil.txt 复制进 destination 的真实目标",
    );
    assert.equal(
      await readFile(join(outsidePkg, "assets", "evil.txt"), "utf8"),
      "evil",
      "沙箱外来源不得被改动",
    );
  } finally {
    await cleanupSandbox(sandbox);
    await rm(root, { recursive: true, force: true });
  }
});

test("编译后来源叶被替换为符号链接时拒绝物化", async () => {
  const root = await mkdtemp(join(tmpdir(), "xas-recall-src-swap-"));
  const sandbox = await createSandbox();
  const file = join(root, "input.txt");
  await writeFile(file, "payload");
  const compiledFile = await readRecallResources(
    [
      {
        source: "input.txt",
        destination: "input.txt",
        kind: "file",
        readOnly: true,
      },
    ],
    root,
    "suite.yaml",
  );
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "host");
  await chmod(sentinel, 0o600);
  const sentinelMode = (await stat(sentinel)).mode & 0o777;
  await rm(file);
  await symlink(sentinel, file);
  try {
    await assert.rejects(
      () =>
        materializeRecallProvision(sandbox, {
          plan: "p",
          resources: compiledFile,
        }),
      /符号链接/,
    );
    assert.equal(await readFile(sentinel, "utf8"), "host");
    assert.equal((await stat(sentinel)).mode & 0o777, sentinelMode);
  } finally {
    await cleanupSandbox(sandbox);
    await rm(root, { recursive: true, force: true });
  }
});

test("编译后来源树内新增符号链接时拒绝物化", async () => {
  const root = await mkdtemp(join(tmpdir(), "xas-recall-src-late-"));
  const sandbox = await createSandbox();
  const assets = join(root, "assets");
  await mkdir(assets);
  await writeFile(join(assets, "a.txt"), "a");
  const compiled = await readRecallResources(
    [
      {
        source: "assets",
        destination: "pkg",
        kind: "directory",
        readOnly: true,
      },
    ],
    root,
    "suite.yaml",
  );
  const sentinel = join(root, "sentinel.txt");
  await writeFile(sentinel, "host");
  await chmod(sentinel, 0o600);
  const sentinelMode = (await stat(sentinel)).mode & 0o777;
  await symlink(sentinel, join(assets, "late.txt"));
  try {
    await assert.rejects(
      () =>
        materializeRecallProvision(sandbox, {
          plan: "p",
          resources: compiled,
        }),
      /符号链接/,
    );
    assert.equal(await readFile(sentinel, "utf8"), "host");
    assert.equal(
      (await stat(sentinel)).mode & 0o777,
      sentinelMode,
      "新增链接的目标权限不得被 chmod",
    );
  } finally {
    await cleanupSandbox(sandbox);
    await rm(root, { recursive: true, force: true });
  }
});
