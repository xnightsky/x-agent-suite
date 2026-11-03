/**
 * @module @x-agent-suite/sandbox/tests/create-rollback
 * createSandbox 中途失败回滚回归：不得遗留 homeDir/cwd 临时目录。
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { test } from "node:test";
import { createSandbox } from "../src/create.ts";

test("createSandbox：第二个 mkdtemp 失败时回滚已创建的 homeDir", async (t) => {
  const originalMkdtemp = fs.mkdtemp;
  let createdHome: string | undefined;
  let calls = 0;
  t.mock.method(fs, "mkdtemp", async (prefix: string) => {
    calls += 1;
    if (calls === 2) throw new Error("INJECTED_MKDTEMP_FAILURE");
    const path = await originalMkdtemp(prefix);
    createdHome = path;
    return path;
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(() => createSandbox(), /INJECTED_MKDTEMP_FAILURE/);
    assert.ok(createdHome);
    assert.equal(existsSync(createdHome), false, "homeDir 必须回滚");
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    if (createdHome && existsSync(createdHome)) {
      await fs.rm(createdHome, { recursive: true, force: true });
    }
  }
});

test("createSandbox：configFile 创建失败时回滚 homeDir 与 cwd", async (t) => {
  const originalMkdtemp = fs.mkdtemp;
  const created: string[] = [];
  t.mock.method(fs, "mkdtemp", async (prefix: string) => {
    const path = await originalMkdtemp(prefix);
    created.push(path);
    return path;
  });
  t.mock.method(fs, "writeFile", async () => {
    throw new Error("INJECTED_CONFIG_WRITE_FAILURE");
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(
      () => createSandbox({ configFile: true }),
      /INJECTED_CONFIG_WRITE_FAILURE/,
    );
    assert.equal(created.length, 2);
    for (const path of created) {
      assert.equal(existsSync(path), false, `${path} 必须回滚`);
    }
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    await Promise.all(
      created.map((path) => fs.rm(path, { recursive: true, force: true })),
    );
  }
});
