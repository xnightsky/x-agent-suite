/**
 * @module @x-agent-suite/harness/resolve-command
 * resolveHarnessCommand：把 harness CLI 名解析为可直接 spawn 的形态。
 * 背景：win32 下全局 CLI 多为 npm 脚本 shim（.cmd），Node 修复 CVE-2024-27980 后
 * 直接 spawn 会抛 EINVAL；可行路径是命中 .exe，或推导 shim 同目录
 * node_modules/<globalPackage>/<binPath> 后用 process.execPath 拉起。
 * 找不到或入口缺失时抛 HarnessUnavailableError，由 preflight 吸收并降级 skip。
 */
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

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
