/**
 * @module @x-agent-suite/sandbox/cleanup
 * cleanupSandbox：测试结束后清理沙箱临时目录。
 *
 * 不变量：E2E_KEEP_SANDBOX=1 时打印路径并跳过删除（供事后诊断）；
 * configDirs / runtimeDir 均位于 homeDir 下，随 homeDir 一并删除。
 *
 * win32 实测：宿主拉起的插件子进程在 PTY kill 后不会立即退出，仍持有托管插件目录句柄，
 * 直删会 EBUSY，故采用有限退避重试；穷尽后只警告不报错（临时目录泄漏不应把一个已通过
 * 的测试拘红，留给 OS 回收）。
 */
import { rm } from "node:fs/promises";
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
    rmWithRetry(sandbox.homeDir, "homeDir"),
    rmWithRetry(sandbox.cwd, "cwd"),
  ]);
}
