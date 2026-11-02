/**
 * @module @x-agent-suite/assertions/workspace-path
 * 以显式 workspace 为唯一边界的词法路径归一。
 * 不变量：不访问文件系统，不推断进程 cwd，不将外部路径视为同一资源。
 */
import { posix, win32 } from "node:path";

function isWindowsWorkspace(workspaceCwd: string): boolean {
  return (
    /^[A-Za-z]:[\\/]/.test(workspaceCwd) || workspaceCwd.startsWith("\\\\")
  );
}

function isOutside(relative: string, separator: string): boolean {
  return (
    relative === ".." ||
    relative.startsWith(".." + separator) ||
    posix.isAbsolute(relative) ||
    win32.isAbsolute(relative)
  );
}

/**
 * 将工具输入路径归一为 workspace 相对的 POSIX 逻辑路径。
 * @param workspaceCwd 本轮可信的绝对 workspace 边界。
 * @param inputPath 工具声明的相对或绝对输入路径。
 * @returns 内部路径（根为 "."）；路径在 workspace 外时返回 undefined。
 * @throws TypeError 边界不是绝对路径或输入为空、无法可信归一时抛出。
 */
export function normalizeWorkspacePath(
  workspaceCwd: string,
  inputPath: string,
): string | undefined {
  if (workspaceCwd.length === 0 || inputPath.length === 0) {
    throw new TypeError("workspaceCwd 与 inputPath 必须是非空字符串");
  }
  const windows = isWindowsWorkspace(workspaceCwd);
  const flavor = windows ? win32 : posix;
  if (!flavor.isAbsolute(workspaceCwd)) {
    throw new TypeError("workspaceCwd 必须是与路径风格一致的绝对路径");
  }
  const root = flavor.normalize(workspaceCwd);
  const candidate = windows ? inputPath : inputPath.replaceAll("\\", "/");
  const resolved = flavor.resolve(root, candidate);
  const relative = flavor.relative(root, resolved);
  if (isOutside(relative, flavor.sep)) return undefined;
  return relative === "" ? "." : relative.split(flavor.sep).join("/");
}
