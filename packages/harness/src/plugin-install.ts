/**
 * @module @x-agent-suite/harness/plugin-install
 * 在沙箱 KIMI_CODE_HOME 内安装本地插件，复现某宿主 `/plugins install <path>` 的落盘结果。 // BOUNDARY-DEBT(harness): 迁移遗留，宿主专用安装语义
 *
 * 不变量（均为实测形态）：
 * - 插件落在 `<kimiHome>/plugins/managed/<id>/`，注册表为 `<kimiHome>/plugins/installed.json`； // BOUNDARY-DEBT(harness): 宿主目录语义
 * - 拷贝**必须过滤** `.git` / `node_modules` / `tmp` / `.pnpm-store`：真实 `/plugins install`
 *   不过滤，会把 workspace 符号链接一并带入，导致托管副本实际运行源码仓（隔离被击穿）；
 * - 符号链接一律解引用（dereference），托管副本内不得存在指回源码仓的链接；
 * - 清单缺失或声明的入口文件不存在时**显式抛错**，不静默安装出一个跑不起来的插件。
 */
import { cp, mkdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, win32 } from "node:path";
import { writeJsonFile } from "./mcp-config";

/** 一个待安装的本地插件。 */
export interface PluginInstallSpec {
  /** 插件 id，同时是 managed 目录名；缺省取清单 name。 */
  readonly id?: string;
  /** 插件源码目录绝对路径（含 kimi.plugin.json）。 */ // BOUNDARY-DEBT(harness): 宿主清单文件名
  readonly sourceDir: string;
  /** 追加排除的顶层目录/文件名（与默认清单合并）。 */
  readonly exclude?: readonly string[];
}

/** 单个插件的安装结果。 */
export interface InstalledPlugin {
  /** 插件 id。 */
  readonly id: string;
  /** 沙箱内托管副本绝对路径。 */
  readonly root: string;
  /** 清单声明的 hook 命令原文（诊断用）。 */
  readonly hookCommands: readonly string[];
  /** 清单声明的 MCP server 名列表（诊断用）。 */
  readonly mcpServers: readonly string[];
}

/** 默认排除清单：版本库、依赖树、临时产物。 */
const DEFAULT_EXCLUDE = [".git", "node_modules", "tmp", ".pnpm-store"] as const;

/** kimi.plugin.json 中本模块关心的字段。 */ // BOUNDARY-DEBT(harness): 宿主清单文件名
interface KimiPluginManifest {
  // BOUNDARY-DEBT(harness): 宿主清单类型
  name?: string;
  hooks?: { event?: string; command?: string }[];
  mcpServers?: Record<string, { command?: string; args?: string[] }>;
}

/**
 * 在沙箱 kimiHome 内安装一组本地插件并写注册表。
 *
 * @behavior plugin-install
 * Given: 调用方给出沙箱 kimiHome 与一组含 kimi.plugin.json 的插件源码目录。 // BOUNDARY-DEBT(harness): 宿主清单文件名
 * When: 调用 installKimiPlugins。 // BOUNDARY-DEBT(harness): 宿主专用函数名，迁移遗留
 * Then: 每个插件拷入 `<kimiHome>/plugins/managed/<id>/`（排除默认清单与 spec.exclude
 *   声明的顶层项，符号链接均 dereference 为实体），`<kimiHome>/plugins/installed.json`
 *   按入参顺序列出全部条目（enabled=true、source="local-path"），返回值与入参同序。
 * Failure: 清单读不到或非法 JSON、既无 spec.id 也无清单 name、清单声明的 hook / MCP
 *   入口在托管副本中不存在（含被排除清单过滤掉的情形），均显式抛带上下文的 Error，
 *   不静默装出一个跑不起来的插件。
 *
 * @param kimiHome 沙箱 KIMI_CODE_HOME 绝对路径。 // BOUNDARY-DEBT(harness): 宿主环境变量名
 * @param plugins 待安装插件清单。
 * @returns 各插件的安装结果，顺序与入参一致。
 */
export async function installKimiPlugins( // BOUNDARY-DEBT(harness): 宿主专用函数名，迁移遗留
  kimiHome: string,
  plugins: readonly PluginInstallSpec[],
): Promise<InstalledPlugin[]> {
  const managedRoot = join(kimiHome, "plugins", "managed");
  await mkdir(managedRoot, { recursive: true });

  const installed: InstalledPlugin[] = [];
  for (const spec of plugins) {
    installed.push(await installOne(managedRoot, spec));
  }

  await writeJsonFile(join(kimiHome, "plugins", "installed.json"), {
    version: 1,
    plugins: installed.map((p, index) => ({
      id: p.id,
      root: p.root,
      source: "local-path",
      enabled: true,
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      originalSource: resolve(plugins[index]!.sourceDir),
    })),
  });

  return installed;
}

/** 安装单个插件：读清单 → 过滤拷贝 → 校验入口。 */
async function installOne(
  managedRoot: string,
  spec: PluginInstallSpec,
): Promise<InstalledPlugin> {
  const sourceDir = resolve(spec.sourceDir);
  const manifest = await readManifest(sourceDir);
  const id = spec.id ?? manifest.name;
  if (!id) {
    throw new Error(
      // BOUNDARY-DEBT(harness): 宿主清单文件名
      `installKimiPlugins: ${sourceDir} 的 kimi.plugin.json 缺少 name，且未显式传 id`,
    );
  }

  const root = resolveManagedPluginRoot(managedRoot, id);
  const excluded = new Set<string>([
    ...DEFAULT_EXCLUDE,
    ...(spec.exclude ?? []),
  ]);
  await cp(sourceDir, root, {
    recursive: true,
    dereference: true,
    filter: (src) => !excluded.has(relativeTopLevel(sourceDir, src)),
  });

  const hookCommands = (manifest.hooks ?? [])
    .map((h) => h.command ?? "")
    .filter(Boolean);
  const mcpServers = Object.entries(manifest.mcpServers ?? {});
  await assertEntriesExist(root, id, [
    ...hookCommands.flatMap(commandEntryFiles),
    ...mcpServers.flatMap(([, server]) =>
      commandEntryFiles(
        [server.command ?? "", ...(server.args ?? [])].join(" "),
      ),
    ),
  ]);

  return {
    id,
    root,
    hookCommands,
    mcpServers: mcpServers.map(([name]) => name),
  };
}

/** 读取并解析插件清单；缺失或非法均显式抛错。 */
async function readManifest(sourceDir: string): Promise<KimiPluginManifest> {
  const file = join(sourceDir, "kimi.plugin.json"); // BOUNDARY-DEBT(harness): 宿主清单文件名
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    throw new Error(
      `installKimiPlugins: 读不到插件清单 ${file}：${describe(error)}`,
    );
  }
  try {
    return JSON.parse(raw) as KimiPluginManifest;
  } catch (error) {
    throw new Error(
      `installKimiPlugins: ${file} 不是合法 JSON：${describe(error)}`,
    );
  }
}

/** 取 src 相对源码根的第一段路径；src 即根时返回空串（不被排除）。 */
function relativeTopLevel(sourceDir: string, src: string): string {
  const rel = resolve(src)
    .slice(sourceDir.length)
    .replace(/^[\\/]+/, "");
  return rel.split(/[\\/]/)[0] ?? "";
}

/** 校验插件 id 只能表示 managedRoot 的一个直接子目录。 */
function resolveManagedPluginRoot(managedRoot: string, id: string): string {
  const unsafe =
    id.trim() !== id ||
    id === "." ||
    id === ".." ||
    id.includes("/") ||
    id.includes("\\") ||
    id.includes("\0") ||
    isAbsolute(id) ||
    win32.isAbsolute(id);
  if (unsafe)
    throw new Error(`installKimiPlugins: 插件 id 非法：${JSON.stringify(id)}`);
  const root = resolve(managedRoot, id);
  if (relative(resolve(managedRoot), root) !== id) {
    throw new Error(`installKimiPlugins: 插件 id 非法：${JSON.stringify(id)}`);
  }
  return root;
}

/** 按空白切词并合并任意位置的单/双引号片段；不执行 shell 展开。 */
function commandTokens(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let started = false;
  for (const char of command) {
    if (quote !== null) {
      if (char === quote) quote = null;
      else current += char;
      started = true;
    } else if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) tokens.push(current);
      current = "";
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (quote !== null)
    throw new Error("installKimiPlugins: 清单命令含未闭合引号");
  if (started) tokens.push(current);
  return tokens;
}

const MODULE_SPECIFIER_FLAGS = new Set([
  "--import",
  "--require",
  "-r",
  "--loader",
  "--experimental-loader",
]);

function isPathLikeRelative(candidate: string): boolean {
  return (
    candidate.includes("/") ||
    candidate.includes("\\") ||
    /\.(?:[cm]?[jt]s|tsx|jsx|py|sh)$/i.test(candidate)
  );
}

function collectEntry(
  entries: string[],
  candidate: string,
  moduleSpecifier: boolean,
): void {
  if (
    /^\.\.[\\/]/.test(candidate) ||
    isAbsolute(candidate) ||
    win32.isAbsolute(candidate)
  ) {
    throw new Error(`installKimiPlugins: 清单入口必须位于插件根：${candidate}`);
  }
  if (
    /^\.[\\/]/.test(candidate) ||
    (!moduleSpecifier && isPathLikeRelative(candidate))
  ) {
    entries.push(candidate);
  }
}

/**
 * 从 hook/MCP 命令行全部参数中提取显式相对入口。
 * 解释器是首 token；Node module flag 的 bare specifier 忽略，但显式路径仍校验。
 */
function commandEntryFiles(command: string): string[] {
  const entries: string[] = [];
  const tokens = commandTokens(command);
  const commandToken = tokens[0];
  if (
    commandToken &&
    !isAbsolute(commandToken) &&
    !win32.isAbsolute(commandToken)
  ) {
    collectEntry(entries, commandToken, false);
  }
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (MODULE_SPECIFIER_FLAGS.has(token)) {
      const value = tokens[index + 1];
      if (value !== undefined) collectEntry(entries, value, true);
      index += 1;
      continue;
    }
    if (token.startsWith("-")) {
      const equals = token.indexOf("=");
      if (equals < 1) continue;
      const flag = token.slice(0, equals);
      collectEntry(
        entries,
        token.slice(equals + 1),
        MODULE_SPECIFIER_FLAGS.has(flag),
      );
      continue;
    }
    collectEntry(entries, token, false);
  }
  return entries;
}

/** 校验清单声明的入口文件在托管副本内真实存在且没有嵌套逃逸。 */
async function assertEntriesExist(
  root: string,
  id: string,
  entries: readonly string[],
): Promise<void> {
  const missing: string[] = [];
  for (const entry of new Set(entries)) {
    const file = resolve(root, entry.replace(/\\/g, "/"));
    const rel = relative(root, file);
    if (
      rel === "" ||
      rel === ".." ||
      rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
      isAbsolute(rel)
    ) {
      throw new Error(`installKimiPlugins: 清单入口必须位于插件根：${entry}`);
    }
    const ok = await stat(file).then(
      (s) => s.isFile(),
      () => false,
    );
    if (!ok) missing.push(entry);
  }
  if (missing.length > 0) {
    throw new Error(
      `installKimiPlugins: 插件 ${id} 清单声明的入口在托管副本中不存在：${missing.join(", ")}` +
        `（源码目录是否漏了构建产物，或入口被排除清单过滤？）`,
    );
  }
}

/** 归一错误描述。 */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
