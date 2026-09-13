/**
 * @module @x-agent-suite/sandbox/provision
 * provision 参考实现：把能力包 / fixture 目录铺进沙箱的宿主可见位置。
 *
 * 不变量：
 * - target 必须是相对路径且不越出沙箱基准目录（拒绝绝对路径与 `..` 逃逸）；
 * - 默认 copy（跨平台安全）；symlink 是 POSIX 语义选项，Windows 需特权，显式选择才用；
 * - 来源缺失或目标非法显式抛错（配置错误不等于评测失败）。
 */

import { cp, symlink } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import type { SandboxContext } from "@x-agent-suite/contracts";

/** provision 条目：一个来源目录到沙箱内目标位置的铺设声明。 */
export interface ProvisionEntry {
  /** 来源目录绝对路径（通常是仓内的能力包 / fixture）。 */
  readonly source: string;
  /** 目标相对路径（基于 base 解析；禁止绝对路径与 `..` 逃逸）。 */
  readonly target: string;
  /** 基准目录：`home`（默认，宿主可见配置面）或 `cwd`（项目面）。 */
  readonly base?: "home" | "cwd";
  /** 铺设方式：`copy`（默认，跨平台安全）或 `symlink`（POSIX 语义，Windows 需特权）。 */
  readonly mode?: "copy" | "symlink";
}

/** 解析并校验目标绝对路径；越界显式抛错。 */
function resolveTarget(sandbox: SandboxContext, entry: ProvisionEntry): string {
  const baseDir = entry.base === "cwd" ? sandbox.cwd : sandbox.homeDir;
  if (isAbsolute(entry.target)) {
    throw new Error(`provision target 必须是相对路径：${entry.target}`);
  }
  const resolved = resolve(baseDir, entry.target);
  if (resolved !== baseDir && !resolved.startsWith(baseDir + sep)) {
    throw new Error(`provision target 越出沙箱基准目录：${entry.target}`);
  }
  return resolved;
}

/** 按声明把来源目录铺进沙箱；任一失败即抛错（已铺条目不回滚，沙箱整体销毁兜底）。 */
export async function provisionSandbox(
  sandbox: SandboxContext,
  entries: readonly ProvisionEntry[],
): Promise<void> {
  for (const entry of entries) {
    const target = resolveTarget(sandbox, entry);
    if (entry.mode === "symlink") {
      await symlink(resolve(entry.source), target, "junction");
    } else {
      await cp(resolve(entry.source), target, { recursive: true });
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
