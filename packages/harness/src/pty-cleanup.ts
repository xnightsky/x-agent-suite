/**
 * @module @x-agent-suite/harness/pty-cleanup
 * PTY driver 的资源清理阶段：PTY → sandbox teardown → backend → sandbox。
 * 不变量：所有阶段都尝试；任一失败时最终抛 AggregateError，禁止首错中断造成残留。
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
}

async function cleanupStep(
  run: () => void | Promise<void>,
  errors: unknown[],
): Promise<void> {
  try {
    await run();
  } catch (error) {
    errors.push(error);
  }
}

/** 按固定顺序清理 PTY driver 全部资源，并在末尾聚合报告错误。 */
export async function cleanupPtyDriverResources(
  options: PtyCleanupOptions,
): Promise<void> {
  const errors: unknown[] = [];
  await cleanupStep(
    () => options.pty?.close(`PtyAgentDriver(${options.profileName}) 关闭`),
    errors,
  );
  const sandbox = options.sandbox;
  const teardown = options.sandboxTeardown;
  if (sandbox && teardown) await cleanupStep(() => teardown(sandbox), errors);
  await cleanupStep(() => options.backend.stop(), errors);
  if (sandbox) await cleanupStep(() => cleanupSandbox(sandbox), errors);
  if (errors.length === 0) return;
  const detail = errors
    .map((error) => (error instanceof Error ? error.message : String(error)))
    .join("; ");
  throw new AggregateError(
    errors,
    `PtyAgentDriver(${options.profileName}) close: ${detail}`,
  );
}
