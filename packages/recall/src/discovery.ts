/**
 * @module @x-agent-suite/recall/discovery
 * 固定 .recall 发现规则；不创建目录、不递归、按绝对路径排序。
 */
import { readdir, stat } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";

const DEFAULT_DIRECTORY = ".recall";
const DEFAULT_CONFIG = "x-agent-suite.config.ts";

/** 考卷发现入参；显式 target 优先于 config.files。 */
export interface FindRecallFilesOptions {
  readonly cwd: string;
  readonly configPath: string;
  readonly target?: string;
  readonly configuredFiles?: readonly string[];
}

/** 解析显式配置或 cwd/.recall/x-agent-suite.config.ts。 */
export async function findRecallConfig(
  cwd: string,
  explicitPath?: string,
): Promise<string> {
  const configPath = explicitPath
    ? resolve(cwd, explicitPath)
    : resolve(cwd, DEFAULT_DIRECTORY, DEFAULT_CONFIG);
  if (!(await isFile(configPath))) {
    throw new Error("未发现 Recall 运行配置：" + configPath);
  }
  return configPath;
}

/** 发现考卷：显式文件/目录 > config.files > 默认 .recall 第一层。 */
export async function findRecallFiles(
  options: FindRecallFilesOptions,
): Promise<string[]> {
  if (options.target) {
    const target = resolve(options.cwd, options.target);
    const info = await statTarget(target);
    const files = info.isDirectory()
      ? await readYamlDirectory(target)
      : [assertYamlFile(target)];
    return requireFiles(files);
  }
  if (options.configuredFiles !== undefined) {
    const base = dirname(options.configPath);
    const files = options.configuredFiles.map((file) =>
      assertYamlFile(resolve(base, file)),
    );
    for (const file of files) {
      if (!(await isFile(file))) throw new Error("Recall 考卷不存在：" + file);
    }
    return requireFiles(files);
  }
  return requireFiles(
    await readYamlDirectory(resolve(options.cwd, DEFAULT_DIRECTORY)),
  );
}

async function readYamlDirectory(directory: string): Promise<string[]> {
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

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}
