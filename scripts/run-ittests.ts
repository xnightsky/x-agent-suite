/**
 * @module scripts/run-ittests
 * 集成测试入口：打平发现包与教程 itest，按完整后缀排除 token 用例。
 * 不变量：文件位置不承担安全职责；任何 `*.token.ittest.ts` 都不进入默认回归；
 * 默认模式保持 skip-friendly，显式 `--require-executed` 才拒绝全 skip 假成功。
 */
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");

/** TAP 汇总中 required 模式需要的执行统计。 */
export interface IttestTapSummary {
  readonly tests: number;
  readonly pass: number;
  readonly fail: number;
  readonly cancelled: number;
  readonly skipped: number;
  readonly executed: number;
}

/** 解析 Node test runner 的 TAP 汇总；缺少可判定计数时返回 null。 */
export function parseTapSummary(output: string): IttestTapSummary | null {
  const counts = new Map<string, number>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^# (tests|pass|fail|cancelled|skipped) (\d+)$/.exec(line);
    if (match) counts.set(match[1]!, Number(match[2]));
  }
  const tests = counts.get("tests");
  const pass = counts.get("pass");
  const fail = counts.get("fail");
  const skipped = counts.get("skipped");
  if (
    tests === undefined ||
    pass === undefined ||
    fail === undefined ||
    skipped === undefined
  ) {
    return null;
  }
  const cancelled = counts.get("cancelled") ?? 0;
  return { tests, pass, fail, cancelled, skipped, executed: pass + fail };
}

/** required 模式只允许在至少一个用例实际 pass/fail 时成功。 */
export function shouldRejectRequiredSummary(
  summary: IttestTapSummary | null,
): boolean {
  return summary === null || summary.executed === 0;
}

function waitForExit(child: ReturnType<typeof spawn>): Promise<number> {
  return new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolveExit(code ?? (signal ? 1 : 0));
    });
  });
}

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
export async function discoverIttestFiles(root: string): Promise<string[]> {
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

/** 运行发现出的默认 itest，并透传退出状态；required 模式阻止全 skip 假成功。 */
async function main(): Promise<void> {
  const required = process.argv.includes("--require-executed");
  const files = await discoverIttestFiles(ROOT);
  if (files.length === 0) {
    if (required) {
      console.error(
        "required itest 模式要求至少一个可执行用例，但未发现 itest",
      );
      process.exitCode = 1;
      return;
    }
    console.log("未发现默认 itest（token 用例不会进入本命令）");
    return;
  }
  if (!required) {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--test", ...files],
      { cwd: ROOT, env: process.env, stdio: "inherit" },
    );
    process.exitCode = await waitForExit(child);
    return;
  }

  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--test", "--test-reporter=tap", ...files],
    { cwd: ROOT, env: process.env, stdio: ["inherit", "pipe", "inherit"] },
  );
  let output = "";
  child.stdout?.on("data", (chunk: Buffer | string) => {
    const text = String(chunk);
    output += text;
    process.stdout.write(text);
  });
  const exitCode = await waitForExit(child);
  if (exitCode === 0) {
    const summary = parseTapSummary(output);
    if (shouldRejectRequiredSummary(summary)) {
      console.error(
        summary
          ? `required itest 模式失败：tests=${summary.tests}, executed=${summary.executed}, skipped=${summary.skipped}`
          : "required itest 模式失败：无法解析 TAP 汇总",
      );
      process.exitCode = 1;
      return;
    }
  }
  process.exitCode = exitCode;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
