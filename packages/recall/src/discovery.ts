/**
 * @module @x-agent-suite/recall/discovery
 * Recall 考卷发现：显式目标优先，否则读取 .recall 第一层 YAML；不发现 TS config。
 */
import { readdir, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";

const DEFAULT_DIRECTORY = ".recall";

/** 考卷发现入参；excludePath 仅用于默认目录中的显式执行 Plan。 */
export interface FindRecallFilesOptions {
  /** 调用工作目录。 */
  readonly cwd: string;
  /** 显式 YAML 文件或目录。 */
  readonly target?: string;
  /** 默认或显式目录发现时排除的执行 Plan 文件。 */
  readonly excludePath?: string;
}

/** 发现考卷：显式文件/目录 > 默认 .recall 第一层；不递归。 */
export async function findRecallFiles(
  options: FindRecallFilesOptions,
): Promise<string[]> {
  const excludePath = options.excludePath
    ? resolve(options.cwd, options.excludePath)
    : undefined;
  if (options.target) {
    const target = resolve(options.cwd, options.target);
    const info = await statTarget(target);
    const files = info.isDirectory()
      ? await readYamlDirectory(target, excludePath)
      : [assertYamlFile(target)];
    return requireFiles(files);
  }
  return requireFiles(
    await readYamlDirectory(
      resolve(options.cwd, DEFAULT_DIRECTORY),
      excludePath,
    ),
  );
}

async function readYamlDirectory(
  directory: string,
  excludePath?: string,
): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (cause) {
    const message =
      (cause as NodeJS.ErrnoException).code === "ENOENT"
        ? "未发现 Recall 考卷："
        : "无法读取 Recall 考卷目录：";
    throw new Error(message + directory, { cause });
  }
  return entries
    .filter((entry) => entry.isFile() && isYaml(entry.name))
    .map((entry) => resolve(directory, entry.name))
    .filter((path) => path !== excludePath)
    .sort();
}

function requireFiles(files: string[]): string[] {
  const sorted = [...files].sort();
  if (sorted.length === 0)
    throw new Error("未发现 Recall 考卷（*.yaml / *.yml）");
  return sorted;
}

function assertYamlFile(file: string): string {
  if (!isYaml(file)) throw new Error("Recall 考卷必须是 YAML 文件：" + file);
  return file;
}

function isYaml(file: string): boolean {
  return [".yaml", ".yml"].includes(extname(file).toLowerCase());
}

async function statTarget(target: string) {
  try {
    return await stat(target);
  } catch (cause) {
    throw new Error("Recall 目标不存在：" + target, { cause });
  }
}
