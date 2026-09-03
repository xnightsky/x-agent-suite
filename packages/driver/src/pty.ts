/**
 * @module @x-agent-suite/driver/pty
 * PTY 子进程句柄：分配 TTY 拉起宿主，提供屏幕快照与 waitForScreen。
 * 不变量：start/close 幂等；write 不自动追加换行；关闭时先 SIGTERM 超时后 SIGKILL；
 * pty 模块优先加载 node-pty，失败回退 @lydell/node-pty；TTY 尺寸在 profile 中固定。
 * Windows 下保留系统 ConPTY；node-pty 枚举助手无法附着控制台时安静回退 shell PID，
 * 避免清理阶段向宿主 stderr 泄漏辅助进程异常。
 */
import type { IDisposable, IPty } from "node-pty";
import {
  createPtyScreen,
  type CursorPosition,
  type PtyScreen,
} from "./pty-screen.ts";

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const DEFAULT_TERM = "xterm-256color";
const DEFAULT_KILL_GRACE_MS = 2_000;

/** 可加载的 PTY 模块形状（node-pty 与 @lydell/node-pty API 一致）。 */
interface PtyModule {
  spawn(file: string, args: string[] | string, options: unknown): IPty;
}

/** PTY 子进程选项。 */
export interface PtyProcessOptions {
  /** 可执行命令。 */
  readonly command: string;
  /** 命令行参数。 */
  readonly args?: readonly string[];
  /** 工作目录。 */
  readonly cwd?: string;
  /** 环境变量（缺省继承当前进程，并注入 TERM）。 */
  readonly env?: NodeJS.ProcessEnv;
  /** 终端列数；默认 80。 */
  readonly cols?: number;
  /** 终端行数；默认 24。 */
  readonly rows?: number;
  /** TERM 值；默认 xterm-256color。 */
  readonly term?: string;
  /** 优雅退出宽限（毫秒）；默认 2000。 */
  readonly killGraceMs?: number;
}

/** PTY 子进程句柄。 */
export interface PtyProcess {
  /** 拉起宿主；就绪判定由调用方用 waitForScreen 完成。 */
  start(): Promise<void>;
  /** 写入按键或文本（不自动追加换行）。 */
  write(data: string): void;
  /** 当前屏幕快照。 */
  screen(): string;
  /** 当前光标位置。 */
  cursor(): CursorPosition;
  /** 等待屏幕出现匹配内容；超时显式抛错并附最后一屏。 */
  waitForScreen(match: RegExp, timeoutMs: number): Promise<void>;
  /** 订阅屏幕变化；返回取消订阅函数。 */
  onScreenChange(listener: () => void): () => void;
  /** 幂等关闭。 */
  close(reason?: string): Promise<void>;
}

/**
 * 加载 PTY 模块：优先 node-pty，失败回退 @lydell/node-pty。
 *
 * @throws 两个模块均加载失败时抛带上下文的 Error。
 */
async function loadPtyModule(): Promise<PtyModule> {
  const errors: string[] = [];
  for (const name of ["node-pty", "@lydell/node-pty"]) {
    try {
      const mod = normalizePtyModule(await import(name));
      return mod;
    } catch (error) {
      errors.push(
        `${name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  throw new Error(`PtyProcess: 无法加载 PTY 模块（${errors.join("；")}）`);
}

/** 归一化 PTY 模块：兼容 ESM default 包装与直接 CJS 导出。 */
function normalizePtyModule(mod: unknown): PtyModule {
  if (mod && typeof (mod as PtyModule).spawn === "function") {
    return mod as PtyModule;
  }
  const defaulted = (mod as { default?: unknown }).default;
  if (defaulted && typeof (defaulted as PtyModule).spawn === "function") {
    return defaulted as PtyModule;
  }
  throw new Error("PTY 模块未导出有效的 spawn 函数");
}

/**
 * PTY 子进程实现：包装 node-pty / @lydell/node-pty 与 @xterm/headless 屏幕缓冲。
 *
 * @behavior pty-process-lifecycle
 * Given: 调用方给出 command/args。
 * When: start 后 write 写入 stdin、screen/waitForScreen 读取屏幕、close 终止进程。
 * Then: PTY 输出喂入屏幕缓冲；write 不自动追加换行；close 幂等，先 SIGTERM 超时后 SIGKILL
 *（Windows 直接 kill）；等待退出时若超时则 resolve 并继续清理。
 * Failure: 重复 start、向未启动/已关闭进程 write、spawn 失败均显式抛带上下文的 Error。
 */
export class PtyProcess implements PtyProcess {
  private readonly options: PtyProcessOptions;
  private readonly screenBuffer: PtyScreen;
  private pty: IPty | null = null;
  private dataDisposable: IDisposable | null = null;
  private started = false;
  private closed = false;
  private closePromise: Promise<void> | null = null;

  constructor(options: PtyProcessOptions) {
    if (!options.command) {
      throw new Error("PtyProcess: command 不能为空");
    }
    this.options = options;
    this.screenBuffer = createPtyScreen({
      cols: options.cols ?? DEFAULT_COLS,
      rows: options.rows ?? DEFAULT_ROWS,
      term: options.term ?? DEFAULT_TERM,
    });
  }

  /** 子进程 pid（未启动为 undefined）。 */
  get pid(): number | undefined {
    return this.pty?.pid;
  }

  /** 拉起子进程；spawn 失败显式抛错，重复 start 显式抛错。 */
  async start(): Promise<void> {
    if (this.started) {
      throw new Error(
        `PtyProcess: 重复 start（command=${this.options.command}）`,
      );
    }
    const mod = await loadPtyModule();
    const env: NodeJS.ProcessEnv = {
      ...(this.options.env ?? process.env),
      TERM: this.options.term ?? DEFAULT_TERM,
    };
    const cols = this.options.cols ?? DEFAULT_COLS;
    const rows = this.options.rows ?? DEFAULT_ROWS;
    try {
      this.pty = mod.spawn(
        this.options.command,
        [...(this.options.args ?? [])],
        {
          name: this.options.term ?? DEFAULT_TERM,
          cols,
          rows,
          cwd: this.options.cwd,
          env,
        },
      );
    } catch (error) {
      throw new Error(
        `PtyProcess spawn 失败（${this.options.command}）: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    this.dataDisposable = this.pty.onData((data) =>
      this.screenBuffer.feed(data),
    );
    this.started = true;
  }

  /** 写入按键或文本到 PTY；未启动或已关闭显式抛错。 */
  write(data: string): void {
    if (!this.pty || this.closed) {
      throw new Error(
        `PtyProcess: 进程未运行，无法写入（command=${this.options.command}）`,
      );
    }
    this.pty.write(data);
  }

  /** 当前屏幕快照。 */
  screen(): string {
    return this.screenBuffer.snapshot();
  }

  /** 当前光标位置。 */
  cursor(): CursorPosition {
    return this.screenBuffer.cursor();
  }

  /** 等待屏幕出现匹配内容；超时显式抛错并附最后一屏。 */
  waitForScreen(match: RegExp, timeoutMs: number): Promise<void> {
    return this.screenBuffer.waitForScreen(match, timeoutMs);
  }

  /** 订阅屏幕变化；返回取消订阅函数。 */
  onScreenChange(listener: () => void): () => void {
    return this.screenBuffer.onChange(listener);
  }

  /** 幂等关闭：先优雅退出，超时后强杀。 */
  close(reason?: string): Promise<void> {
    this.closePromise ??= this.doClose(reason);
    return this.closePromise;
  }

  private async doClose(_reason?: string): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.dataDisposable?.dispose();
    this.dataDisposable = null;

    const pty = this.pty;
    if (!pty) {
      this.screenBuffer.dispose();
      return;
    }

    const grace = this.options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
    if (process.platform === "win32") {
      // Windows 不支持 POSIX 信号语义，直接 kill。
      pty.kill();
      await this.waitExit(grace);
    } else {
      pty.kill("SIGTERM");
      const exited = await this.waitExit(grace);
      if (!exited) {
        pty.kill("SIGKILL");
        await this.waitExit(grace);
      }
    }

    this.screenBuffer.dispose();
    this.pty = null;
  }

  /** 等待进程退出，超时返回 false。 */
  private waitExit(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const pty = this.pty;
      if (!pty) {
        resolve(true);
        return;
      }
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
      }, timeoutMs);
      timer.unref?.();
      const disposable = pty.onExit(() => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          disposable.dispose();
          resolve(true);
        }
      });
    });
  }
}
