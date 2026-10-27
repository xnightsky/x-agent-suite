/**
 * @module @x-agent-suite/recall/tests/discovery
 * .recall 考卷发现：显式目标、非递归、稳定顺序与执行 Plan 排除。
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { findRecallFiles } from "../src/discovery.ts";

async function fixture(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "xas-recall-discovery-"));
  await mkdir(join(cwd, ".recall", "nested"), { recursive: true });
  await writeFile(join(cwd, ".recall", "x-agent-suite.config.ts"), "obsolete");
  await writeFile(join(cwd, ".recall", "execution.yaml"), "version: 1");
  await writeFile(join(cwd, ".recall", "b.yaml"), "");
  await writeFile(join(cwd, ".recall", "a.yml"), "");
  await writeFile(join(cwd, ".recall", "nested", "ignored.yaml"), "");
  await writeFile(join(cwd, ".recall", "ignored.txt"), "");
  return cwd;
}

test("默认发现第一层 YAML 并排除显式执行 Plan，不读取 TS config", async () => {
  const cwd = await fixture();
  try {
    const files = await findRecallFiles({
      cwd,
      excludePath: join(cwd, ".recall", "execution.yaml"),
    });
    assert.deepEqual(files, [
      join(cwd, ".recall", "a.yml"),
      join(cwd, ".recall", "b.yaml"),
    ]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("显式目录只读第一层，显式单文件优先于默认发现", async () => {
  const cwd = await fixture();
  const other = join(cwd, "other");
  await mkdir(other);
  try {
    await assert.rejects(
      findRecallFiles({ cwd, target: other }),
      /未发现.*考卷/,
    );
    await writeFile(join(other, "one.yaml"), "");
    await writeFile(join(other, "execution.yaml"), "version: 1");
    assert.deepEqual(
      await findRecallFiles({
        cwd,
        target: other,
        excludePath: join(other, "execution.yaml"),
      }),
      [join(other, "one.yaml")],
    );
    assert.deepEqual(
      await findRecallFiles({ cwd, target: join(cwd, ".recall", "a.yml") }),
      [join(cwd, ".recall", "a.yml")],
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("缺考卷、不存在目标与非 YAML 均显式失败", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "xas-recall-missing-"));
  try {
    await assert.rejects(findRecallFiles({ cwd }), /未发现.*考卷/);
    await assert.rejects(
      findRecallFiles({ cwd, target: join(cwd, "ghost") }),
      /不存在/,
    );
    await writeFile(join(cwd, "not-yaml.txt"), "");
    await assert.rejects(
      findRecallFiles({ cwd, target: join(cwd, "not-yaml.txt") }),
      /YAML|yaml|yml/,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
