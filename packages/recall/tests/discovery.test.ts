/**
 * @module @x-agent-suite/recall/tests/discovery
 * .recall 配置与考卷发现：优先级、显式目标、非递归和稳定顺序。
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { findRecallConfig, findRecallFiles } from "../src/discovery.ts";

async function fixture(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "xas-recall-discovery-"));
  await mkdir(join(cwd, ".recall", "nested"), { recursive: true });
  await writeFile(join(cwd, ".recall", "x-agent-suite.config.ts"), "");
  await writeFile(join(cwd, ".recall", "b.yaml"), "");
  await writeFile(join(cwd, ".recall", "a.yml"), "");
  await writeFile(join(cwd, ".recall", "nested", "ignored.yaml"), "");
  await writeFile(join(cwd, ".recall", "ignored.txt"), "");
  return cwd;
}

test("自动发现固定配置和第一层 YAML，按路径稳定排序且不递归", async () => {
  const cwd = await fixture();
  try {
    const configPath = await findRecallConfig(cwd);
    const files = await findRecallFiles({ cwd, configPath });
    assert.equal(configPath, join(cwd, ".recall", "x-agent-suite.config.ts"));
    assert.deepEqual(files, [
      join(cwd, ".recall", "a.yml"),
      join(cwd, ".recall", "b.yaml"),
    ]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("显式 config 优先；显式目录只读该目录第一层", async () => {
  const cwd = await fixture();
  const other = join(cwd, "other");
  await mkdir(other);
  const configPath = join(other, "custom.ts");
  await writeFile(configPath, "");
  try {
    assert.equal(await findRecallConfig(cwd, configPath), configPath);
    await assert.rejects(
      findRecallFiles({ cwd, configPath, target: other }),
      /未发现.*考卷/,
    );
    await writeFile(join(other, "one.yaml"), "");
    assert.deepEqual(
      await findRecallFiles({ cwd, configPath, target: other }),
      [join(other, "one.yaml")],
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("显式单文件与 config.files 覆盖默认目录发现", async () => {
  const cwd = await fixture();
  const configPath = join(cwd, ".recall", "x-agent-suite.config.ts");
  const configured = join(cwd, ".recall", "b.yaml");
  try {
    assert.deepEqual(
      await findRecallFiles({ cwd, configPath, configuredFiles: ["b.yaml"] }),
      [configured],
    );
    assert.deepEqual(
      await findRecallFiles({
        cwd,
        configPath,
        configuredFiles: ["b.yaml"],
        target: join(cwd, ".recall", "a.yml"),
      }),
      [join(cwd, ".recall", "a.yml")],
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("缺配置、缺考卷和非法目标均显式失败", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "xas-recall-missing-"));
  try {
    await assert.rejects(
      findRecallConfig(cwd),
      /运行配置|x-agent-suite.config.ts/,
    );
    const configPath = join(cwd, "config.ts");
    await writeFile(configPath, "");
    await assert.rejects(findRecallFiles({ cwd, configPath }), /未发现.*考卷/);
    await assert.rejects(
      findRecallFiles({ cwd, configPath, target: join(cwd, "ghost") }),
      /不存在/,
    );
    await writeFile(join(cwd, "not-yaml.txt"), "");
    await assert.rejects(
      findRecallFiles({ cwd, configPath, target: join(cwd, "not-yaml.txt") }),
      /YAML|yaml|yml/,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
