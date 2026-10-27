#!/usr/bin/env node
/**
 * @module packaging/cli
 * 聚合包统一命令入口；eval/run/diff 继续走原 Runner，recall 走原生声明式加载器。
 */
import { main as runnerMain } from "../packages/runner/src/cli.ts";
import { main as recallMain } from "../packages/recall/src/cli.ts";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** 分发统一 CLI；不改变既有 eval <config> 语义。 */
export async function main(
  argv: readonly string[],
  options: { readonly cwd?: string } = {},
): Promise<number> {
  return argv[0] === "recall"
    ? recallMain(argv.slice(1), options)
    : runnerMain(argv);
}

const invokedAsScript =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) ===
    realpathSync(fileURLToPath(import.meta.url));
if (invokedAsScript) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    });
}
