/**
 * @module @x-agent-suite/recall/tests/resources-race
 * 资源父目录创建冲突的回归验证。
 * 不变量：检查与创建之间出现的条目必须重新校验，不得经链接写出沙箱。
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cleanupSandbox, createSandbox } from "@x-agent-suite/sandbox";
import { materializeRecallProvision } from "../src/resources.ts";

test("创建父目录遇到并发插入的链接时拒绝，不写入外部目录", async (t) => {
  const sandbox = await createSandbox();
  const outside = await fs.mkdtemp(join(tmpdir(), "xas-recall-race-"));
  const parent = join(sandbox.cwd, "parent");
  const originalMkdir = fs.mkdir;
  t.mock.method(fs, "mkdir", async (path: string) => {
    if (path === parent) await fs.symlink(outside, parent, "junction");
    return originalMkdir(path);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(
      materializeRecallProvision(sandbox, {
        context: {
          files: [{ path: "parent/escaped.txt", content: "escaped" }],
        },
      }),
      /destination 父级含符号链接/,
    );
    assert.deepEqual(await fs.readdir(outside), []);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    await cleanupSandbox(sandbox);
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("创建父目录遇到并发出现的实体目录时仍正常物化", async (t) => {
  const sandbox = await createSandbox();
  const parent = join(sandbox.cwd, "parent");
  const originalMkdir = fs.mkdir;
  t.mock.method(fs, "mkdir", async (path: string) => {
    if (path === parent) await originalMkdir(path);
    return originalMkdir(path);
  });
  syncBuiltinESMExports();
  try {
    await materializeRecallProvision(sandbox, {
      context: { files: [{ path: "parent/file.txt", content: "payload" }] },
    });
    assert.equal(
      await fs.readFile(join(parent, "file.txt"), "utf8"),
      "payload",
    );
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    await cleanupSandbox(sandbox);
  }
});
