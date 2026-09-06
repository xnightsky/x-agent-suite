/**
 * @module @x-agent-suite/harness/tests/resolve-local-bin
 * resolveLocalBinCommand 的回归测试：本地包 bin 解析（win32 pnpm 本地 shim 场景的兜底）。
 * 夹具在临时目录运行时搭建，避免仓库内嵌 node_modules 被忽略。
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  HarnessUnavailableError,
  resolveLocalBinCommand,
} from "../src/resolve-command.ts";

/** 在临时目录搭一个带 bin 的假包，返回解析基准目录与包内入口路径。 */
async function makeLocalPackage(): Promise<{ baseDir: string; binEntry: string }> {
  const root = await mkdtemp(join(tmpdir(), "xas-local-bin-"));
  const pkgDir = join(root, "node_modules", "@xas-fixture", "fake-cli");
  await mkdir(join(pkgDir, "bin"), { recursive: true });
  await writeFile(
    join(pkgDir, "package.json"),
    JSON.stringify({
      name: "@xas-fixture/fake-cli",
      version: "0.0.0",
      bin: { "fake-cli": "bin/cli.js" },
    }),
    "utf8",
  );
  const binEntry = join(pkgDir, "bin", "cli.js");
  await writeFile(binEntry, "// fake cli\n", "utf8");
  return { baseDir: root, binEntry };
}

test("resolveLocalBinCommand：从调用方基准解析本地包 bin 并用当前 node 拉起", async () => {
  const { baseDir, binEntry } = await makeLocalPackage();
  const resolved = await resolveLocalBinCommand({
    packageName: "@xas-fixture/fake-cli",
    binName: "fake-cli",
    baseDir,
  });
  assert.equal(resolved.command, process.execPath);
  assert.deepEqual([...resolved.argsPrefix], [binEntry]);
});

test("resolveLocalBinCommand：包不可解析时抛 HarnessUnavailableError", async () => {
  const { baseDir } = await makeLocalPackage();
  await assert.rejects(
    resolveLocalBinCommand({
      packageName: "@xas-fixture/not-installed",
      baseDir,
    }),
    (error: unknown) => {
      assert.ok(error instanceof HarnessUnavailableError);
      assert.match((error as Error).message, /@xas-fixture\/not-installed/);
      return true;
    },
  );
});

test("resolveLocalBinCommand：bin 为映射且未命中 binName 时显式报错", async () => {
  const { baseDir } = await makeLocalPackage();
  await assert.rejects(
    resolveLocalBinCommand({
      packageName: "@xas-fixture/fake-cli",
      binName: "other-name",
      baseDir,
    }),
    HarnessUnavailableError,
  );
});
