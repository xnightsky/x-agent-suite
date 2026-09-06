/**
 * @module @x-agent-suite/harness/json-seed
 * ensureJsonEntry：共享 JSON 配置文件的「读-校验-跳过」播种。
 * 背景：多端共享同一配置目录时（如双端 harness 共用配置根），并发读-改-写会丢失更新、
 * 运行中的宿主可能读到半截文件。约定 setup 阶段先播种、启动期全走跳过分支：
 * 条目已存在且一致则不写，缺失才合并写入，存在但不一致显式报错（不静默覆盖）。
 */
import { deepStrictEqual } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { writeJsonFile } from "./mcp-config.ts";

/** 读取 JSON 对象文件；ENOENT 视为空对象，解析/读取失败显式抛带路径的错误。 */
async function readJsonObject(file: string): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw new Error(`读取失败 "${file}": ${(error as Error).message}`);
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch (error) {
    throw new Error(`解析失败 "${file}": ${(error as Error).message}`);
  }
  throw new Error(`"${file}" 内容不是 JSON 对象`);
}

/** 键序无关的 JSON 深比较。 */
function jsonValueEqual(left: unknown, right: unknown): boolean {
  try {
    deepStrictEqual(left, right);
    return true;
  } catch {
    return false;
  }
}

/**
 * 保证 JSON 对象文件的指定键路径含期望条目：
 * 已存在且一致则跳过（不写），缺失则读-合并-写，存在但不一致显式报错。
 * @param file 目标文件绝对路径（不存在时创建）。
 * @param keyPath 条目键路径（至少一段；中间层级缺失时按对象补齐）。
 * @param expected 期望的条目值（键序无关深比较）。
 */
export async function ensureJsonEntry(
  file: string,
  keyPath: readonly string[],
  expected: unknown,
): Promise<void> {
  if (keyPath.length === 0) {
    throw new Error("ensureJsonEntry: keyPath 至少一段");
  }
  const existing = await readJsonObject(file);
  let parent = existing;
  for (const key of keyPath.slice(0, -1)) {
    const next = parent[key];
    parent =
      next !== null && typeof next === "object" && !Array.isArray(next)
        ? (next as Record<string, unknown>)
        : {};
  }
  const current = parent[keyPath[keyPath.length - 1]!];
  if (current !== undefined) {
    if (jsonValueEqual(current, expected)) {
      return;
    }
    throw new Error(
      `"${file}" 的条目 ${keyPath.join(".")} 与期望不一致`,
    );
  }
  // 自顶向下逐层复制，仅替换键路径沿线，保留全部兄弟键。
  const merge = (
    node: Record<string, unknown>,
    depth: number,
  ): Record<string, unknown> => {
    const key = keyPath[depth]!;
    if (depth === keyPath.length - 1) {
      return { ...node, [key]: expected };
    }
    const child = node[key];
    const childObject =
      child !== null && typeof child === "object" && !Array.isArray(child)
        ? (child as Record<string, unknown>)
        : {};
    return { ...node, [key]: merge(childObject, depth + 1) };
  };
  await writeJsonFile(file, merge(existing, 0));
}
