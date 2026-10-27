/**
 * @module @x-agent-suite/recall/context
 * 只读 context 文件物化为 provision 数据；词法与 realpath 双重防目录逃逸。
 */
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

/** provision 中的一个只读上下文文件。 */
export interface RecallContextFile {
  readonly path: string;
  readonly content: string;
}

/** 读取 rootDir 内的上下文文件；绝对路径、逃逸和非普通文件显式拒绝。 */
export async function readContextFiles(
  paths: readonly string[],
  rootDir: string,
): Promise<RecallContextFile[]> {
  const root = await realpath(rootDir).catch((cause: unknown) => {
    throw new Error("Recall rootDir 不存在：" + rootDir, { cause });
  });
  if (!(await stat(root)).isDirectory()) {
    throw new Error("Recall rootDir 不是目录：" + rootDir);
  }
  const files: RecallContextFile[] = [];
  for (const declared of paths)
    files.push(await readContextFile(declared, root));
  return files;
}

async function readContextFile(
  declared: string,
  root: string,
): Promise<RecallContextFile> {
  if (isAbsolute(declared)) {
    throw new Error("Recall context 路径必须相对于 rootDir：" + declared);
  }
  const candidate = resolve(root, declared);
  assertContained(root, candidate, declared);
  const actual = await realpath(candidate).catch((cause: unknown) => {
    throw new Error("Recall context 文件不存在：" + declared, { cause });
  });
  assertContained(root, actual, declared);
  if (!(await stat(actual)).isFile()) {
    throw new Error("Recall context 必须是普通文件：" + declared);
  }
  return {
    path: relative(root, candidate).split(sep).join("/"),
    content: await readFile(actual, "utf8"),
  };
}

function assertContained(root: string, target: string, declared: string): void {
  const nested = relative(root, target);
  if (nested === ".." || nested.startsWith(".." + sep) || isAbsolute(nested)) {
    throw new Error("Recall context 路径逃逸 rootDir：" + declared);
  }
}
