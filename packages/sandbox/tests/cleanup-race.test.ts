/**
 * @module @x-agent-suite/sandbox/tests/cleanup-race
 * 清理时目录被替换的回归验证。
 * 不变量：即使目录检查之后出现链接，也不得改写外部目标权限。
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cleanupSandbox, createSandbox } from "../src/index.ts";

test(
  "目录在检查后被换成链接时，清理不改写外部目录权限",
  {
    skip: process.platform === "win32",
  },
  async (t) => {
    const sandbox = await createSandbox();
    const outside = await fs.mkdtemp(join(tmpdir(), "xas-cleanup-race-"));
    const managed = join(sandbox.cwd, "managed");
    await fs.mkdir(managed);
    await fs.chmod(outside, 0o755);
    await fs.writeFile(join(outside, "sentinel.txt"), "keep");
    const originalLstat = fs.lstat;
    let swapped = false;
    t.mock.method(fs, "lstat", async (path: string) => {
      const info = await originalLstat(path);
      if (path === managed && !swapped) {
        swapped = true;
        await fs.rmdir(managed);
        await fs.symlink(outside, managed);
      }
      return info;
    });
    syncBuiltinESMExports();
    try {
      await cleanupSandbox(sandbox);
      assert.equal((await fs.stat(outside)).mode & 0o777, 0o755);
      assert.equal(
        await fs.readFile(join(outside, "sentinel.txt"), "utf8"),
        "keep",
      );
      await assert.rejects(fs.lstat(sandbox.cwd), { code: "ENOENT" });
    } finally {
      t.mock.restoreAll();
      syncBuiltinESMExports();
      await cleanupSandbox(sandbox);
      await fs.rm(outside, { recursive: true, force: true });
    }
  },
);

test(
  "目录在打开后被换成链接时，不经路径 chmod 或继续遍历目标",
  {
    skip: process.platform === "win32",
  },
  async (t) => {
    const sandbox = await createSandbox();
    const outside = await fs.mkdtemp(join(tmpdir(), "xas-cleanup-open-"));
    const nested = join(outside, "nested");
    const managed = join(sandbox.cwd, "managed");
    await fs.mkdir(managed);
    await fs.mkdir(nested);
    await fs.chmod(outside, 0o755);
    await fs.chmod(nested, 0o750);
    const originalOpen = fs.open;
    t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (args[0] === managed) {
        await fs.rename(managed, join(sandbox.cwd, "retired"));
        await fs.symlink(outside, managed);
      }
      return handle;
    });
    syncBuiltinESMExports();
    try {
      await cleanupSandbox(sandbox);
      assert.equal((await fs.stat(outside)).mode & 0o777, 0o755);
      assert.equal((await fs.stat(nested)).mode & 0o777, 0o750);
      await assert.rejects(fs.lstat(sandbox.cwd), { code: "ENOENT" });
    } finally {
      t.mock.restoreAll();
      syncBuiltinESMExports();
      await cleanupSandbox(sandbox);
      await fs.rm(outside, { recursive: true, force: true });
    }
  },
);
