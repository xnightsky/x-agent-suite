/**
 * @module scripts/run-itests
 * 默认集成测试入口：打平发现包与教程 itest，并按完整后缀排除 token 用例。
 * 不变量：文件位置不承担安全职责；任何 `*.token.ittest.ts` 都不进入默认回归。
 */
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");

async function discoverFlatItests(root: string, directory: string) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    },
  );
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".ittest.ts") &&
        !entry.name.endsWith(".token.ittest.ts"),
    )
    .map((entry) => relative(root, join(directory, entry.name)));
}

/**
 * 发现所有包 tests 与教程目录顶层的零 token 集成测试。
 * @param root 仓库根目录。
 * @returns 相对仓库根目录排序后的测试路径。
 */
export async function discoverItestFiles(root: string): Promise<string[]> {
  const packagesDir = join(root, "packages");
  const packages = await readdir(packagesDir, { withFileTypes: true });
  const directories = packages
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packagesDir, entry.name, "tests"));
  directories.push(join(root, "examples", "tutorial"));
  return (
    await Promise.all(directories.map((dir) => discoverFlatItests(root, dir)))
  )
    .flat()
    .sort();
}

/** 运行发现出的默认 itest，并透传退出状态。 */
async function main(): Promise<void> {
  const files = await discoverItestFiles(ROOT);
  if (files.length === 0) {
    console.log("未发现默认 itest（token 用例不会进入本命令）");
    return;
  }
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--test", ...files],
    { cwd: ROOT, env: process.env, stdio: "inherit" },
  );
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolveExit(code ?? (signal ? 1 : 0));
    });
  });
  process.exitCode = exitCode;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
