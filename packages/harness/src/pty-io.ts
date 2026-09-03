/**
 * @module @x-agent-suite/harness/pty-io
 * PTY driver 的进程启动、就绪对话框与输入回显等待。
 */
import type {
  HarnessProfile,
  Redactor,
  SandboxContext,
} from "@x-agent-suite/contracts";
import { PtyProcess } from "@x-agent-suite/driver";
import { resolveHarnessCommand, type ResolvedCommand } from "./resolve-command";

/** 启动 PTY 所需的最小上下文。 */
export interface StartPtyOptions {
  /** 宿主 profile。 */
  readonly profile: HarnessProfile;
  /** 已初始化的 sandbox。 */
  readonly sandbox: SandboxContext;
  /** 测试注入的已解析命令。 */
  readonly commandOverride?: ResolvedCommand;
  /** 可选附加工作目录。 */
  readonly addDir?: string;
}

/** 不阻塞进程退出的延时。 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/** 解析命令并启动 PTY 进程。 */
export async function startPtyProcess(
  options: StartPtyOptions,
): Promise<PtyProcess> {
  const command =
    options.commandOverride ??
    (await resolveHarnessCommand({
      name: options.profile.command,
      ptyCommand: options.profile.ptyCommand,
      win32: options.profile.win32,
    }));
  const cwd = options.addDir ?? options.sandbox.cwd;
  const args = options.profile.ptyArgs!({ cwd, addDir: options.addDir });
  const pty = new PtyProcess({
    command: command.command,
    args: [...command.argsPrefix, ...args],
    cwd,
    env: options.sandbox.env,
  });
  await pty.start();
  return pty;
}

/** 等待 PTY 就绪，并处理 profile 声明的启动对话框。 */
export function waitForPtyReady(
  pty: PtyProcess,
  profile: HarnessProfile,
  timeoutMs: number,
  redactor?: Redactor,
): Promise<void> {
  const readyPattern = profile.ptyReadyPattern!;
  const setupSequence = profile.ptySetupSequence ?? [];
  return new Promise((resolve, reject) => {
    let settled = false;
    let interval: ReturnType<typeof setInterval>;
    let timer: ReturnType<typeof setTimeout>;
    let unsubscribe = () => {};
    const cleanup = () => {
      clearInterval(interval);
      clearTimeout(timer);
      unsubscribe();
    };
    const check = () => {
      if (settled) return;
      const screen = pty.screen();
      if (readyPattern.test(screen)) {
        settled = true;
        cleanup();
        resolve();
        return;
      }
      for (const step of setupSequence) {
        if (step.match.test(screen)) {
          pty.write(step.input);
          return;
        }
      }
    };
    interval = setInterval(check, 100);
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      const screen = redactor?.(pty.screen()) ?? pty.screen();
      reject(
        new Error(`等待 PTY 就绪超时（${timeoutMs}ms），最后一屏：\n${screen}`),
      );
    }, timeoutMs);
    timer.unref?.();
    unsubscribe = pty.onScreenChange(check);
    check();
  });
}

/** 等待 prompt 首行的非空白 marker 出现在屏幕。 */
export async function waitForPtyEcho(
  pty: PtyProcess,
  text: string,
  timeoutMs: number,
): Promise<boolean | undefined> {
  const marker = (text.split(/\r?\n/)[0] ?? "")
    .replace(/\s+/g, "")
    .slice(0, 12);
  if (!marker) return undefined;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pty.screen().replace(/\s+/g, "").includes(marker)) return true;
    await delay(50);
  }
  return false;
}
