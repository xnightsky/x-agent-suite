/**
 * @module @x-agent-suite/harness/resolve-command
 * resolveHarnessCommand：把 harness CLI 名解析为可直接 spawn 的形态。
 * 背景：win32 下全局 CLI 多为 npm 脚本 shim（.cmd），Node 修复 CVE-2024-27980 后
 * 直接 spawn 会抛 EINVAL；可行路径是命中 .exe，或推导 shim 同目录
 * node_modules/<globalPackage>/<binPath> 后用 process.execPath 拉起。
 * resolveLocalBinCommand：兜底座——win32 下包管理器把仓库本地 .bin 置于 PATH 首位时
 * 全局前缀布局推导失效，改经模块解析定位调用方本地包的 bin 入口。
 * 找不到或入口缺失时抛 HarnessUnavailableError，由 preflight 吸收并降级 skip。
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";

/** CLI 不可用错误：preflight 捕获后应 skip 对应 harness 而非判红。 */
export class HarnessUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HarnessUnavailableError";
  }
}

/** 待解析的 CLI 描述。 */
export interface HarnessCommandSpec {
  /** shim 名。 */
  readonly name: string;
  /**
   * PTY/TUI 模式下优先使用的可执行命令（如 win32 的 "kimi.cmd"）。 // BOUNDARY-DEBT(harness): 示例命令名，由 profile 注册时声明
   * 指定时直接按该名在 PATH 中查找，跳过 win32 node shim 推导。
   */
  readonly ptyCommand?: string;
  /**
   * win32 脚本 shim 的入口推导：shim 同目录 node_modules 下的全局包与 bin 相对路径。
   * binPath 以 .exe 结尾时直接 spawn 该 exe，否则用 process.execPath 拉起。
   * 原生 exe 型 CLI 不声明此字段。
   */
  readonly win32?: { readonly globalPackage: string; readonly binPath: string };
  /** 测试注入：仅在该目录内查找 shim（替代 PATH 搜索）。 */
  readonly pathOverride?: string;
}

/** 可直接传给 spawn 的解析结果。 */
export interface ResolvedCommand {
  /** spawn 的 command（posix 为 shim 名，win32 为绝对路径）。 */
  readonly command: string;
  /** 需要前置到业务参数之前的参数（win32 node shim 时为入口 js 路径）。 */
  readonly argsPrefix: readonly string[];
}

/** 在搜索目录内查找 shim，返回绝对路径与扩展名；找不到返回 null。 */
function findShim(
  dirs: readonly string[],
  name: string,
): { path: string; ext: string } | null {
  const candidates =
    process.platform === "win32"
      ? [`${name}.exe`, `${name}.cmd`, `${name}.bat`, name]
      : [name];
  for (const dir of dirs) {
    for (const candidate of candidates) {
      const full = join(dir, candidate);
      if (existsSync(full)) {
        const ext = candidate.slice(name.length);
        return { path: full, ext };
      }
    }
  }
  return null;
}

/**
 * 解析 harness CLI 为可 spawn 形态。
 * @param spec CLI 描述（含可选的 win32 入口推导信息）。
 * @returns spawn 参数；不可用时抛 HarnessUnavailableError。
 */
export async function resolveHarnessCommand(
  spec: HarnessCommandSpec,
): Promise<ResolvedCommand> {
  const dirs = spec.pathOverride
    ? [spec.pathOverride]
    : (process.env.PATH ?? "").split(delimiter);

  // PTY 模式优先使用显式命令名（如 win32 的 "kimi.cmd"），node-pty 可直接 spawn 脚本 shim。 // BOUNDARY-DEBT(harness): 示例命令名，由 profile 注册时声明
  if (spec.ptyCommand) {
    const shim = findShim(dirs, spec.ptyCommand);
    if (shim) {
      return { command: shim.path, argsPrefix: [] };
    }
    throw new HarnessUnavailableError(
      `PTY 命令 "${spec.ptyCommand}" 不在 PATH 中`,
    );
  }

  const shim = findShim(dirs, spec.name);
  if (!shim) {
    throw new HarnessUnavailableError(`CLI "${spec.name}" 不在 PATH 中`);
  }
  if (process.platform !== "win32") {
    return { command: spec.name, argsPrefix: [] };
  }
  if (shim.ext === ".exe") {
    return { command: shim.path, argsPrefix: [] };
  }
  if (!spec.win32) {
    throw new HarnessUnavailableError(
      `win32 下 "${spec.name}" 是脚本 shim（${shim.path}），且未声明 win32 入口推导`,
    );
  }
  const entry = join(
    shim.path.slice(0, shim.path.length - (spec.name.length + shim.ext.length)),
    "node_modules",
    spec.win32.globalPackage,
    spec.win32.binPath,
  );
  if (!existsSync(entry)) {
    throw new HarnessUnavailableError(
      `win32 下 "${spec.name}" 的入口不存在：${entry}`,
    );
  }
  if (entry.endsWith(".exe")) {
    return { command: entry, argsPrefix: [] };
  }
  return { command: process.execPath, argsPrefix: [entry] };
}

/** 本地已安装包的 bin 解析描述。 */
export interface LocalBinSpec {
  /** 包名；须可从 baseDir 沿 node_modules 向上解析到（通常为调用仓的 devDependency）。 */
  readonly packageName: string;
  /** bin 名；package.json 的 bin 为字符串形态时可省略，为映射形态时必填。 */
  readonly binName?: string;
  /**
   * 解析基准目录（从它开始逐级向上找 node_modules）；缺省为 process.cwd()。
   * 包管理器严格布局下本模块看不到调用仓的 devDependency，跨仓使用必须显式传。
   */
  readonly baseDir?: string;
}

/** 从 baseDir 逐级向上查找 node_modules/<packageName>/package.json；找不到返回 null。 */
function findLocalPackageDir(
  baseDir: string,
  packageName: string,
): string | null {
  let dir = baseDir;
  for (;;) {
    const candidate = join(dir, "node_modules", packageName);
    if (existsSync(join(candidate, "package.json"))) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

/**
 * 从调用方本地安装的包解析 bin 入口，用当前 node 拉起。
 * 用途：win32 下包管理器把仓库本地 .bin 置于 PATH 首位时，resolveHarnessCommand 的
 * 全局前缀布局推导会得到不存在的入口路径；此时改走本函数——沿 node_modules 定位包根、
 * 读其 package.json 的 bin 声明，与 posix 下 PATH shim 实际指向的包完全一致。
 * @param spec 本地包 bin 解析描述。
 * @returns spawn 参数（bin 为 .exe 时直接 spawn）；不可用时抛 HarnessUnavailableError。
 */
export async function resolveLocalBinCommand(
  spec: LocalBinSpec,
): Promise<ResolvedCommand> {
  const packageRoot = findLocalPackageDir(
    spec.baseDir ?? process.cwd(),
    spec.packageName,
  );
  if (!packageRoot) {
    throw new HarnessUnavailableError(
      `未安装 ${spec.packageName}（从 ${spec.baseDir ?? process.cwd()} 向上未找到）`,
    );
  }
  const manifest = JSON.parse(
    await readFile(join(packageRoot, "package.json"), "utf8"),
  ) as { bin?: string | Record<string, string> };
  const binRel =
    typeof manifest.bin === "string"
      ? manifest.bin
      : spec.binName
        ? manifest.bin?.[spec.binName]
        : undefined;
  if (!binRel) {
    throw new HarnessUnavailableError(
      `${spec.packageName} 未声明可用的 bin 入口${spec.binName ? `（${spec.binName}）` : ""}`,
    );
  }
  const entry = join(packageRoot, binRel);
  if (!existsSync(entry)) {
    throw new HarnessUnavailableError(
      `${spec.packageName} 的 bin 入口不存在：${entry}`,
    );
  }
  if (entry.endsWith(".exe")) {
    return { command: entry, argsPrefix: [] };
  }
  return { command: process.execPath, argsPrefix: [entry] };
}
