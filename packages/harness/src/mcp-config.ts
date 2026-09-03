/**
 * @module @x-agent-suite/harness/mcp-config
 * 各宿主 MCP 配置的共享构建件。
 * 不变量：stdio 入口是 .ts 源码，故 server spawn 一律为 process.execPath + --import tsx + 入口绝对路径；
 * --import 必须给 file:// URL（import.meta.resolve 的返回值），win32 盘符路径会被拒。
 */
import { writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import type { ServerSpawnSpec } from "@x-agent-suite/contracts";

/**
 * 构建 stdio MCP server 的 spawn 描述（node + tsx 直跑 ts 源码）。
 * @param entryTs mcp-stdio-entry.ts 的绝对路径。
 * @param env 注入 server 进程的环境变量。
 */
export function buildMcpServerSpec(
  entryTs: string,
  env?: Record<string, string>,
): ServerSpawnSpec {
  return {
    command: process.execPath,
    args: ["--import", import.meta.resolve("tsx/esm"), entryTs],
    env,
  };
}

/**
 * 以 JSON 写文件（父目录自动创建），供各 profile 的 writeConfig 使用。
 * @param file 目标文件绝对路径。
 * @param value 待序列化的配置对象。
 */
export async function writeJsonFile(
  file: string,
  value: unknown,
): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/**
 * TOML 基本字符串字面量（复用 JSON 转义，覆盖反斜杠与引号）。
 * @param value 原始字符串。
 */
export function tomlString(value: string): string {
  return JSON.stringify(value);
}
