/**
 * @module @x-agent-suite/sandbox/tests/provision
 * provisionSandbox 单元测试：铺设、基准选择、越界与缺源拒绝。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
      /.*/,
    );
  } finally {
    await cleanup();
  }
});
