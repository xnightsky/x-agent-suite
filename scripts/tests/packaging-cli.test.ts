/**
 * @module scripts/tests/packaging-cli
 * 构建后统一 CLI：Unix shebang 与符号链接启动必须真正进入 main。
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { build } from "esbuild";

const ROOT = resolve(import.meta.dirname, "../..");
let stage: string;
let bundle: string;
let link: string;

before(async () => {
  await mkdir(join(ROOT, ".tmp"), { recursive: true });
  stage = await mkdtemp(join(ROOT, ".tmp", "xas-packaging-cli-"));
  bundle = join(stage, "cli.js");
  link = join(stage, "x-agent-suite");
  await build({
    absWorkingDir: ROOT,
    entryPoints: ["packaging/cli.ts"],
    outfile: bundle,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    external: ["tsx"],
    banner: {
      js: 'import { createRequire as __xasCreateRequire } from "node:module"; const require = __xasCreateRequire(import.meta.url);',
    },
  });
  await chmod(bundle, 0o755);
  await symlink(bundle, link);
});

after(async () => {
  await rm(stage, { recursive: true, force: true });
});

test("构建 CLI 可通过直接路径和符号链接执行，且用法错误返回 2", async () => {
  const source = await readFile(bundle, "utf8");
  assert.match(source, /^#!\/usr\/bin\/env node\n/);

  for (const invocation of [
    { command: bundle, args: [] },
    { command: link, args: [] },
    { command: process.execPath, args: [link] },
  ]) {
    const result = await run(invocation.command, invocation.args);
    assert.equal(
      result.code,
      2,
      invocation.command + " 应进入 main 并返回用法错误",
    );
    assert.match(result.stderr, /用法：x-agent-suite eval/);
  }
});

async function run(command: string, args: readonly string[]) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(command, args, { cwd: stage, env });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += String(chunk)));
  child.stderr.on("data", (chunk) => (stderr += String(chunk)));
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  return { code, stdout, stderr };
}
