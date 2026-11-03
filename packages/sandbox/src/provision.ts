/**
 * @module @x-agent-suite/sandbox/provision
 * provision 参考实现：把能力包 / fixture 目录铺进沙箱的宿主可见位置。
 *
 * 不变量：
 * - target 必须是相对路径且不越出沙箱基准目录（拒绝绝对路径与 `..` 逃逸）；
 * - copy 来源树与目标父级/既有目标树不得含符号链接；symlink 挂载点不得被后续条目穿透；
 * - 默认 copy（跨平台安全）；symlink 是 POSIX 语义选项，Windows 需特权，显式选择才用；
 * - 来源缺失或目标非法显式抛错（配置错误不等于评测失败）。
 */

import { cp, lstat, readdir, symlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { SandboxContext } from "@x-agent-suite/contracts";

/** provision 条目：一个来源目录到沙箱内目标位置的铺设声明。 */
export interface ProvisionEntry {
  /** 来源目录绝对路径（通常是仓内的能力包 / fixture）。 */
  readonly source: string;
  /** 目标相对路径（基于 base 解析；禁止绝对路径与 `..` 逃逸）。 */
  readonly target: string;
  /** 基准目录：`home`（默认，宿主可见配置面）或 `cwd`（项目面）。 */
  readonly base?: "home" | "cwd";
  /** 铺设方式：`copy`（默认，拒绝来源/目标符号链接）或 `symlink`（POSIX 语义；挂载点不可被后续条目穿透）。 */
  readonly mode?: "copy" | "symlink";
}

interface ResolvedProvisionTarget {
  readonly baseDir: string;
  readonly target: string;
}

/** 解析并校验目标绝对路径；越界显式抛错。 */
function resolveTarget(
  sandbox: SandboxContext,
  entry: ProvisionEntry,
): ResolvedProvisionTarget {
  const baseDir = entry.base === "cwd" ? sandbox.cwd : sandbox.homeDir;
  if (isAbsolute(entry.target)) {
    throw new Error(`provision target 必须是相对路径：${entry.target}`);
  }
  const target = resolve(baseDir, entry.target);
  if (target !== baseDir && !target.startsWith(baseDir + sep)) {
    throw new Error(`provision target 越出沙箱基准目录：${entry.target}`);
  }
  return { baseDir, target };
}

/** 判断 child 是否等于 parent 或位于其下。 */
function isSameOrDescendant(parent: string, child: string): boolean {
  const nested = relative(parent, child);
  return (
    nested === "" ||
    (nested !== ".." && !nested.startsWith(`..${sep}`) && !isAbsolute(nested))
  );
}

/** 读取错误码；非 Node 错误返回 undefined。 */
function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** 来源不存在或不可访问时显式失败。 */
async function assertSourceExists(source: string): Promise<void> {
  try {
    await lstat(source);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      throw new Error(`provision source 缺失：${source}`, { cause: error });
    }
    throw new Error(`provision source 不可访问：${source}`, { cause: error });
  }
}

/** 递归拒绝路径树中的任何符号链接；路径不存在时按空树处理。 */
async function assertNoSymlinks(root: string, label: string): Promise<void> {
  let info;
  try {
    info = await lstat(root);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    throw new Error(`${label}无法校验：${root}`, { cause: error });
  }
  if (info.isSymbolicLink()) {
    throw new Error(`${label}含符号链接：${root}`);
  }
  if (!info.isDirectory()) return;
  for (const name of await readdir(root)) {
    await assertNoSymlinks(join(root, name), label);
  }
}

/** 目标每级已存在父目录必须是真实目录，禁止穿过既有符号链接。 */
async function assertSafeTargetParents(
  baseDir: string,
  target: string,
): Promise<void> {
  const parent = dirname(target);
  const nested = relative(baseDir, parent);
  if (nested === "") return;
  let current = baseDir;
  for (const segment of nested.split(sep)) {
    if (segment === "" || segment === ".") continue;
    current = join(current, segment);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return;
      throw new Error(`provision target 父级无法校验：${current}`, {
        cause: error,
      });
    }
    if (info.isSymbolicLink()) {
      throw new Error(`provision target 父级含符号链接：${current}`);
    }
    if (!info.isDirectory()) {
      throw new Error(`provision target 父级不是目录：${current}`);
    }
  }
}

/** 目标不得落在此前 symlink 条目创建的挂载点内。 */
function assertOutsideMounts(target: string, mounts: readonly string[]): void {
  const mount = mounts.find((candidate) =>
    isSameOrDescendant(candidate, target),
  );
  if (mount) {
    throw new Error(`provision target 不得穿过 symlink 挂载点：${target}`);
  }
}

/** 按声明把来源目录铺进沙箱；任一失败即抛错（已铺条目不回滚，沙箱整体销毁兜底）。 */
export async function provisionSandbox(
  sandbox: SandboxContext,
  entries: readonly ProvisionEntry[],
): Promise<void> {
  const symlinkMounts: string[] = [];
  for (const entry of entries) {
    const { baseDir, target } = resolveTarget(sandbox, entry);
    assertOutsideMounts(target, symlinkMounts);
    await assertSourceExists(resolve(entry.source));
    await assertSafeTargetParents(baseDir, target);
    await assertNoSymlinks(target, "provision target");
    if (entry.mode === "symlink") {
      await symlink(resolve(entry.source), target, "junction");
      symlinkMounts.push(target);
    } else {
      await assertNoSymlinks(resolve(entry.source), "provision copy 来源");
      await cp(resolve(entry.source), target, {
        recursive: true,
        dereference: false,
      });
      await assertNoSymlinks(target, "provision copy 结果");
    }
  }
}

/** 便捷拼接：沙箱 home 下的相对路径（供 driver 工厂声明安装位置）。 */
export function sandboxHomePath(
  sandbox: SandboxContext,
  ...segments: readonly string[]
): string {
  return join(sandbox.homeDir, ...segments);
}
