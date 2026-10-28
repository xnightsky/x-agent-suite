/**
 * @module @x-agent-suite/sandbox/cleanup
 * cleanupSandbox：测试结束后清理沙箱临时目录。
 *
 * 不变量：E2E_KEEP_SANDBOX=1 时打印路径并跳过删除（供事后诊断）；
 * configDirs / runtimeDir 均位于 homeDir 下，随 homeDir 一并删除。
 * POSIX 只读目录在删除前补写位；通过不跟随叶链接的目录句柄 chmod。
 * 前置条件：调用方先停止目录树的写入进程；路径遍历不提供原子的并发隔离。
 *
 * win32 实测：宿主拉起的插件子进程在 PTY kill 后不会立即退出，仍持有托管插件目录句柄，
 * 直删会 EBUSY，故采用有限退避重试；穷尽后只警告不报错（临时目录泄漏不应把一个已通过
 * 的测试拘红，留给 OS 回收）。
 */
import { constants } from "node:fs";
import { lstat, open, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { SandboxContext } from "@x-agent-suite/contracts";

/** 退避重试间隔（毫秒）；总等待上限约 3.1s。 */
const RETRY_DELAYS_MS = [100, 200, 400, 800, 1_600] as const;

/** 不阻塞退出的延时。 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/**
 * 删除一个目录，对 win32 的 EBUSY/ENOTEMPTY/EPERM 退避重试。
 *
 * @behavior sandbox-rm-with-retry
 * Given: 目录可能仍被未退出的子进程占用。
 * When: 调用 rmWithRetry。
 * Then: 首次即成则直接返回；遇可重试错码按 100/200/400/800/1600ms 退避（总等待上限约 3.1s）。
 * Failure: 不可重试错码或重试穷尽时不抛错，仅 stderr 警告并返回——临时目录泄漏
 * 不应把一个已通过的测试拘红，剩余清理交给 OS。
 *
 * @param dir 待删目录绝对路径。
 * @param label 日志标签（穷尽时警告用）。
 */
async function rmWithRetry(dir: string, label: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as { code?: string }).code;
      const retryable =
        code === "EBUSY" || code === "ENOTEMPTY" || code === "EPERM";
      const wait = RETRY_DELAYS_MS[attempt];
      if (!retryable || wait === undefined) {
        console.error(
          `[sandbox] 清理${label}失败（已放弃，留给 OS 回收）：${dir} ← ${code ?? error}`,
        );
        return;
      }
      await delay(wait);
    }
  }
}

/**
 * 递归解锁受管目录树：为真实目录补写位，供后续 rm 删除。
 *
 * 不变量：先 lstat，再以 O_NOFOLLOW | O_DIRECTORY 打开并核对 inode；只对同一目录句柄 chmod。
 * 检查后或打开后被替换的叶链接不会成为 chmod 目标；遍历祖先的并发修改仍须由调用方排除。
 *
 * @param dir 待解锁的绝对路径。
 */
async function unlockManagedDirs(dir: string): Promise<void> {
  const info = await lstat(dir);
  if (!info.isDirectory()) return;
  const handle = await open(
    dir,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY,
  ).catch((error: { code?: string }) => {
    if (["ELOOP", "ENOTDIR", "ENOENT"].includes(error.code ?? "")) return;
    throw error;
  });
  if (handle === undefined) return;
  try {
    const opened = await handle.stat();
    if (opened.dev !== info.dev || opened.ino !== info.ino) return;
    await handle.chmod(0o700);
    const current = await lstat(dir);
    if (current.dev !== opened.dev || current.ino !== opened.ino) return;
    for (const name of await readdir(dir)) {
      await unlockManagedDirs(join(dir, name));
    }
  } finally {
    await handle.close();
  }
}

/**
 * 删除前尽力解锁目录树；失败只做显式诊断，不改变原有 rm 策略。
 *
 * @param dir 待删除的绝对路径。
 * @param label 日志标签（与 rmWithRetry 一致）。
 */
async function unlockBeforeRemoval(dir: string, label: string): Promise<void> {
  // Windows 的目录权限不采用 POSIX 写位；由既有 rm 策略处理只读文件。
  if (process.platform === "win32") return;
  try {
    await unlockManagedDirs(dir);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") return;
    console.error(
      `[sandbox] 清理前解锁${label}失败（仍按原策略删除）：${dir} ← ${code ?? error}`,
    );
  }
}

/**
 * 先解锁再按原重试策略删除一个沙箱目录。
 *
 * @param dir 待删目录绝对路径。
 * @param label 日志标签。
 */
async function removeSandboxDir(dir: string, label: string): Promise<void> {
  await unlockBeforeRemoval(dir, label);
  await rmWithRetry(dir, label);
}

/**
 * 清理沙箱：删除 homeDir 与 cwd（homeDir 下的按需目录随之删除）。
 *
 * @param sandbox 待清理的沙箱上下文。
 */
export async function cleanupSandbox(sandbox: SandboxContext): Promise<void> {
  if (process.env.E2E_KEEP_SANDBOX === "1") {
    console.error(
      `[sandbox] E2E_KEEP_SANDBOX=1，保留沙箱 ${sandbox.id}：homeDir=${sandbox.homeDir} cwd=${sandbox.cwd}`,
    );
    return;
  }
  await Promise.all([
    removeSandboxDir(sandbox.homeDir, "homeDir"),
    removeSandboxDir(sandbox.cwd, "cwd"),
  ]);
}
