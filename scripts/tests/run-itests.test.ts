/**
 * @module scripts/tests/run-itests
 * 默认 itest 文件发现契约：位置可以打平，但 token 用例永不进入默认集合。
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { discoverItestFiles } from "../run-itests.ts";

test("默认 itest 发现包与教程中的普通用例并排除 token 用例", async () => {
  const root = await mkdtemp(join(tmpdir(), "xas-itest-discovery-"));
  const testsDir = join(root, "packages", "demo", "tests");
  const tutorialDir = join(root, "examples", "tutorial");
  try {
    await mkdir(join(testsDir, "token"), { recursive: true });
    await mkdir(tutorialDir, { recursive: true });
    await Promise.all([
      writeFile(join(testsDir, "ordinary.ittest.ts"), ""),
      writeFile(join(testsDir, "live.token.ittest.ts"), ""),
      writeFile(join(testsDir, "ordinary.test.ts"), ""),
      writeFile(join(testsDir, "token", "grouped.token.ittest.ts"), ""),
      writeFile(join(tutorialDir, "09-host.ittest.ts"), ""),
      writeFile(join(tutorialDir, "10-live.token.ittest.ts"), ""),
    ]);

    assert.deepEqual(await discoverItestFiles(root), [
      join("examples", "tutorial", "09-host.ittest.ts"),
      join("packages", "demo", "tests", "ordinary.ittest.ts"),
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
