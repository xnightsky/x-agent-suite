/**
 * @module @x-agent-suite/sandbox/tests/provision
 * provisionSandbox 单元测试：铺设、基准选择、越界与缺源拒绝。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { provisionSandbox, sandboxHomePath } from "../src/provision.ts";
import type { SandboxContext } from "@x-agent-suite/contracts";

/** 构造最小沙箱形状与来源目录。 */
async function makeFixture(): Promise<{
  sandbox: SandboxContext;
  source: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), "xas-provision-"));
  const homeDir = join(root, "home");
  const cwd = join(root, "cwd");
  const source = join(root, "skill");
  await mkdir(homeDir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  await mkdir(join(source, "scripts"), { recursive: true });
  await writeFile(join(source, "SKILL.md"), "# demo-skill\n", "utf8");
  await writeFile(join(source, "scripts", "run.sh"), "echo ok\n", "utf8");
  return {
    sandbox: { homeDir, cwd, env: {}, id: "provision-test" },
    source,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test("copy 模式铺进 home 基准，嵌套文件齐全", async () => {
  const { sandbox, source, cleanup } = await makeFixture();
  try {
    await provisionSandbox(sandbox, [
      { source, target: ".agent/skills/demo-skill" },
    ]);
    const text = await readFile(
      sandboxHomePath(sandbox, ".agent", "skills", "demo-skill", "SKILL.md"),
      "utf8",
    );
    assert.equal(text, "# demo-skill\n");
    await readFile(
      sandboxHomePath(
        sandbox,
        ".agent",
        "skills",
        "demo-skill",
        "scripts",
        "run.sh",
      ),
      "utf8",
    );
  } finally {
    await cleanup();
  }
});

test("cwd 基准与越界/绝对路径拒绝", async () => {
  const { sandbox, source, cleanup } = await makeFixture();
  try {
    await provisionSandbox(sandbox, [
      { source, target: "vendor/skill", base: "cwd" },
    ]);
    await readFile(join(sandbox.cwd, "vendor", "skill", "SKILL.md"), "utf8");
    await assert.rejects(
      () => provisionSandbox(sandbox, [{ source, target: "../escape" }]),
      /越出沙箱基准目录/,
    );
    await assert.rejects(
      () => provisionSandbox(sandbox, [{ source, target: "/abs/path" }]),
      /相对路径/,
    );
    await assert.rejects(
      () =>
        provisionSandbox(sandbox, [
          { source: join(sandbox.homeDir, "ghost"), target: "x" },
        ]),
      /provision source 缺失/,
    );
  } finally {
    await cleanup();
  }
});

test("copy 来源树含符号链接时拒绝且不把链接目标带入 sandbox", async (t) => {
  const { sandbox, source, cleanup } = await makeFixture();
  const outside = join(sandbox.homeDir, "..", "outside");
  const sentinel = join(outside, "sentinel.txt");
  try {
    await mkdir(outside, { recursive: true });
    await writeFile(sentinel, "outside-secret", "utf8");
    try {
      await symlink(sentinel, join(source, "linked.txt"));
    } catch {
      t.skip("当前平台不允许创建测试符号链接");
      return;
    }

    await assert.rejects(
      () =>
        provisionSandbox(sandbox, [
          { source, target: ".agent/skills/symlink-copy" },
        ]),
      /符号链接/,
    );
    assert.equal(
      existsSync(join(sandbox.homeDir, ".agent", "skills", "symlink-copy")),
      false,
    );
  } finally {
    await cleanup();
  }
});

test("目标父级为符号链接时拒绝且不写 sandbox 外", async (t) => {
  const { sandbox, source, cleanup } = await makeFixture();
  const outside = join(sandbox.homeDir, "..", "outside-parent");
  try {
    await mkdir(outside, { recursive: true });
    try {
      await symlink(outside, join(sandbox.homeDir, "redirect"), "junction");
    } catch {
      t.skip("当前平台不允许创建测试符号链接");
      return;
    }

    await assert.rejects(
      () =>
        provisionSandbox(sandbox, [{ source, target: "redirect/installed" }]),
      /父级.*符号链接/,
    );
    assert.equal(existsSync(join(outside, "installed")), false);
  } finally {
    await cleanup();
  }
});

test("symlink 挂载点创建后，后续 copy 不得穿过挂载点写外部", async (t) => {
  const { sandbox, source, cleanup } = await makeFixture();
  const mountSource = join(sandbox.homeDir, "..", "mount-source");
  const payload = join(sandbox.homeDir, "..", "payload");
  try {
    await mkdir(mountSource, { recursive: true });
    await mkdir(payload, { recursive: true });
    await writeFile(join(payload, "escaped.txt"), "escaped", "utf8");
    try {
      await provisionSandbox(sandbox, [
        { source: mountSource, target: "mounted", mode: "symlink" },
        { source: payload, target: "mounted/written" },
      ]);
      assert.fail("不得允许后续条目穿过 symlink 挂载点");
    } catch (error) {
      assert.match(String(error), /挂载点|符号链接/);
    }
    assert.equal(existsSync(join(mountSource, "written")), false);
  } finally {
    await cleanup();
  }
});

test("目标叶节点为符号链接时拒绝", async (t) => {
  const { sandbox, source, cleanup } = await makeFixture();
  const outside = join(sandbox.homeDir, "..", "outside-leaf");
  try {
    await mkdir(outside, { recursive: true });
    try {
      await symlink(outside, join(sandbox.homeDir, "leaf"), "junction");
    } catch {
      t.skip("当前平台不允许创建测试符号链接");
      return;
    }
    await assert.rejects(
      () => provisionSandbox(sandbox, [{ source, target: "leaf" }]),
      /符号链接/,
    );
    assert.equal(existsSync(join(outside, "SKILL.md")), false);
  } finally {
    await cleanup();
  }
});
