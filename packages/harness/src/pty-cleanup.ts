/**
 * @module @x-agent-suite/harness/pty-cleanup
 * PTY driver 的资源清理阶段：PTY → sandbox teardown → backend → sandbox。
 * 不变量：所有阶段都有界等待并尝试；任一失败/超时后继续后续阶段，最终抛 AggregateError。
 */
import type { PtyProcess } from "@x-agent-suite/driver";
import type { LlmBackend } from "@x-agent-suite/contracts";
import { cleanupSandbox } from "@x-agent-suite/sandbox";
import type { SandboxContext } from "@x-agent-suite/contracts";

/** PTY driver 清理参数。 */
export interface PtyCleanupOptions {
  readonly profileName: string;
  readonly pty: PtyProcess | null;
  readonly backend: LlmBackend;
  readonly sandbox: SandboxContext | null;
  readonly sandboxTeardown?: (sandbox: SandboxContext) => Promise<void>;
  /** 单阶段清理超时（毫秒）；默认 10000。超时后仍继续后续阶段。 */
  readonly stageTimeoutMs?: number;
}

const DEFAULT_STAGE_TIMEOUT_MS = 10_000;

async function cleanupStep(
  label: string,
  timeoutMs: number,
  run: () => void | Promise<void>,
  errors: unknown[],
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(run),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} 超时（${timeoutMs}ms）`)),
          timeoutMs,
        );
      }),
    ]);
  } catch (error) {
    errors.push(error);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** 按固定顺序清理 PTY driver 全部资源，并在末尾聚合报告错误。 */
export async function cleanupPtyDriverResources(
  options: PtyCleanupOptions,
): Promise<void> {
  const errors: unknown[] = [];
  const stageTimeoutMs = options.stageTimeoutMs ?? DEFAULT_STAGE_TIMEOUT_MS;
  await cleanupStep(
    "pty.close",
    stageTimeoutMs,
    () => options.pty?.close(`PtyAgentDriver(${options.profileName}) 关闭`),
    errors,
  );
  const sandbox = options.sandbox;
  const teardown = options.sandboxTeardown;
  if (sandbox && teardown) {
    await cleanupStep(
      "sandboxTeardown",
      stageTimeoutMs,
      () => teardown(sandbox),
      errors,
    );
  }
  await cleanupStep(
    "backend.stop",
    stageTimeoutMs,
    () => options.backend.stop(),
    errors,
  );
  if (sandbox) {
    await cleanupStep(
      "cleanupSandbox",
      stageTimeoutMs,
      () => cleanupSandbox(sandbox),
      errors,
    );
  }
  if (errors.length === 0) return;
  const detail = errors
    .map((error) => (error instanceof Error ? error.message : String(error)))
    .join("; ");
  throw new AggregateError(
    errors,
    `PtyAgentDriver(${options.profileName}) close: ${detail}`,
  );
}
