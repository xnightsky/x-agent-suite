/**
 * @module profiles/pi-recall-evidence
 * 消费者侧文件证据采集；仅读取显式声明的隔离工作区文件。
 * 不变量：拒绝路径逃逸和链接，每个文件最多 64 KiB，缺失与读取错误分别处理。
 */
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

const MAX_BYTES = 65536;

/** 一个文件的清理前内容快照。 */
export interface PiRecallFileEvidence {
  readonly exists: boolean;
  readonly content?: string;
}

async function locateFile(
  root: string,
  path: string,
): Promise<string | undefined> {
  if (typeof path !== "string" || !path || isAbsolute(path)) {
    throw new Error("证据路径必须是非空相对路径");
  }
  const target = resolve(root, path);
  const nested = relative(root, target);
  if (nested === ".." || nested.startsWith(".." + sep) || isAbsolute(nested)) {
    throw new Error("证据路径越出隔离工作区");
  }
  let current = root;
  const segments = nested.split(sep).filter(Boolean);
  for (const [index, segment] of segments.entries()) {
    current = resolve(current, segment);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    if (info.isSymbolicLink()) throw new Error("证据路径包含符号链接");
    if (index < segments.length - 1 && !info.isDirectory()) {
      throw new Error("证据父级不是目录");
    }
    if (index === segments.length - 1 && !info.isFile()) {
      throw new Error("证据不是普通文件");
    }
  }
  if (segments.length === 0) throw new Error("证据不是普通文件");
  return target;
}

async function snapshot(
  path: string | undefined,
): Promise<PiRecallFileEvidence> {
  if (path === undefined) return { exists: false };
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(
        buffer,
        size,
        buffer.length - size,
        null,
      );
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    if (size > MAX_BYTES) throw new Error("证据超过大小限制 65536 字节");
    return { exists: true, content: buffer.subarray(0, size).toString("utf8") };
  } finally {
    await file.close();
  }
}

/** 在工作区仍存在时采集文件内容，缺失文件显式记录为不存在。 */
export async function collectPiRecallEvidence(
  workspace: string,
  paths: Readonly<Record<string, string>>,
): Promise<Record<string, PiRecallFileEvidence>> {
  const info = await lstat(workspace);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error("证据工作区不是隔离实体目录");
  }
  if (!paths || typeof paths !== "object" || Array.isArray(paths)) {
    throw new Error("证据声明必须是路径对象");
  }
  const root = await realpath(workspace);
  const result: [string, PiRecallFileEvidence][] = [];
  for (const [key, path] of Object.entries(paths)) {
    if (!key) throw new Error("证据名称不得为空");
    result.push([key, await snapshot(await locateFile(root, path))]);
  }
  return Object.fromEntries(result);
}
