/**
 * @module @x-agent-suite/harness/tests/resolve-command
 * pathOverride 解析回归：POSIX 必须返回经路径搜索确认的绝对命令。
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { test } from "node:test";
import { resolveHarnessCommand } from "../src/resolve-command.ts";

test(
  "resolveHarnessCommand：pathOverride POSIX 返回可直接 spawn 的绝对路径",
  { skip: process.platform === "win32" },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "xas-resolve-command-"));
    const name = "xas-fake-cli";
    const executable = join(dir, name);
    try {
      await writeFile(executable, "#!/bin/sh\necho resolved-ok\n", "utf8");
      await chmod(executable, 0o755);
      const resolved = await resolveHarnessCommand({
        name,
        pathOverride: relative(process.cwd(), dir),
      });
      assert.ok(isAbsolute(resolved.command), resolved.command);
      const spawned = spawnSync(resolved.command, resolved.argsPrefix, {
        encoding: "utf8",
      });
      assert.ifError(spawned.error);
      assert.equal(spawned.status, 0, spawned.stderr);
      assert.equal(spawned.stdout.trim(), "resolved-ok");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
