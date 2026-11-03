/**
 * @module @x-agent-suite/driver/pty
 * PTY 子进程句柄：分配 TTY 拉起宿主，提供屏幕快照与 waitForScreen。
 * 不变量：start 只能调用一次，close 幂等且为终态；write 不自动追加换行；关闭时先 SIGTERM 超时后 SIGKILL；
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

/** PTY 进程退出信息：退出码或信号仅用于诊断，不作为业务断言依据。 */
export interface PtyExitInfo {
  /** 正常退出码；被信号终止或不可用时为 null。 */
  readonly exitCode: number | null;
  /** 终止信号编号；无信号时 null。 */
  readonly signal: number | null;
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
  /** 最近一次退出信息；未退出时 null。 */
  exitInfo(): PtyExitInfo | null;
  /** 等待进程退出；退出信息只解析一次。 */
  waitForExit(): Promise<PtyExitInfo>;
  /** 幂等关闭。 */
  close(reason?: string): Promise<void>;
}

type PtyLifecycleState =
  "new" | "starting" | "running" | "exited" | "closing" | "closed";

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
  private permanentExitDisposable: IDisposable | null = null;
  private state: PtyLifecycleState = "new";
  private closePromise: Promise<void> | null = null;
  private startPromise: Promise<void> | null = null;
  private exitValue: PtyExitInfo | null = null;
  private exitPromise: Promise<PtyExitInfo> | null = null;
  private resolveExit: ((info: PtyExitInfo) => void) | null = null;

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

  /** 子进程 pid（未启动或已关闭为 undefined）。 */
  get pid(): number | undefined {
    return this.pty?.pid;
  }

  /** 拉起子进程；start 是终态入口，close 后禁止 restart。 */
  start(): Promise<void> {
    if (this.state !== "new") {
      return Promise.reject(
        new Error(
          `PtyProcess: 重复 start 或已关闭，禁止 start（command=${this.options.command}，state=${this.state}）`,
        ),
      );
    }
    this.state = "starting";
    this.startPromise = this.doStart();
    return this.startPromise;
  }

  /** start 实现；close 可在异步加载/订阅期间抢占。 */
  private async doStart(): Promise<void> {
    let mod: PtyModule;
    try {
      mod = await loadPtyModule();
    } catch (error) {
      if (this.state === "starting") {
        this.state = "closed";
        this.screenBuffer.dispose();
      }
      throw error;
    }
    if (this.state !== "starting") {
      throw new Error(
        `PtyProcess: 启动期间已关闭（command=${this.options.command}）`,
      );
    }
    const env: NodeJS.ProcessEnv = {
      ...(this.options.env ?? process.env),
      TERM: this.options.term ?? DEFAULT_TERM,
    };
    const cols = this.options.cols ?? DEFAULT_COLS;
    const rows = this.options.rows ?? DEFAULT_ROWS;
    let pty: IPty;
    try {
      pty = mod.spawn(this.options.command, [...(this.options.args ?? [])], {
        name: this.options.term ?? DEFAULT_TERM,
        cols,
        rows,
        cwd: this.options.cwd,
        env,
      });
    } catch (error) {
      if (this.state === "starting") {
        this.state = "closed";
        this.screenBuffer.dispose();
      }
      throw new Error(
        `PtyProcess spawn 失败（${this.options.command}）: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    this.pty = pty;
    this.exitValue = null;
    this.exitPromise = new Promise<PtyExitInfo>((resolve) => {
      this.resolveExit = resolve;
    });
    try {
      // 必须在 spawn 后立即永久注册；close/waitExit 不得成为唯一监听者。
      this.permanentExitDisposable = pty.onExit(({ exitCode, signal }) => {
        this.recordExit(exitCode, signal);
      });
      this.dataDisposable = pty.onData((data) => this.screenBuffer.feed(data));
    } catch (error) {
      try {
        pty.kill("SIGTERM");
      } catch {
        // 订阅失败后的 kill 只是 best-effort；close 仍可继续清理。
      }
      if (this.state === "starting") {
        this.state = "closed";
      }
      throw new Error(
        `PtyProcess 事件订阅失败（command=${this.options.command}）: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const startupExit = this.exitInfo();
    if (startupExit) {
      if (this.state === "starting") this.state = "closed";
      throw new Error(
        `PtyProcess 启动期间进程已退出（command=${this.options.command}，exitCode=${startupExit.exitCode}，signal=${startupExit.signal}）`,
      );
    }
    if (this.state !== "starting") {
      throw new Error(
        `PtyProcess: 启动期间已关闭（command=${this.options.command}）`,
      );
    }
    this.state = "running";
  }

  /** 记录唯一一次退出事件，供 driver 与 close 共同观察。 */
  private recordExit(exitCode: number, signal?: number): void {
    if (this.exitValue) return;
    this.exitValue = { exitCode, signal: signal ?? null };
    this.resolveExit?.(this.exitValue);
    this.resolveExit = null;
    if (this.state === "running") this.state = "exited";
  }

  /** 最近一次退出信息；未退出时 null。 */
  exitInfo(): PtyExitInfo | null {
    return this.exitValue;
  }

  /** 等待进程退出；未启动时显式拒绝。 */
  waitForExit(): Promise<PtyExitInfo> {
    if (this.exitValue) return Promise.resolve(this.exitValue);
    if (this.exitPromise) return this.exitPromise;
    return Promise.reject(
      new Error(`PtyProcess: 进程尚未启动（command=${this.options.command}）`),
    );
  }

  /** 写入按键或文本到 PTY；未运行或已退出显式抛错。 */
  write(data: string): void {
    if (this.state !== "running" || !this.pty) {
      throw new Error(
        `PtyProcess: 进程未运行，无法写入（command=${this.options.command}，state=${this.state}）`,
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

  /** 幂等关闭：close 是终态；启动期间调用也会等待并回收新资源。 */
  close(_reason?: string): Promise<void> {
    if (!this.closePromise) {
      this.state = "closing";
      this.closePromise = this.doClose();
    }
    return this.closePromise;
  }

  /** 关闭实现：正常退出、SIGTERM、SIGKILL 都汇聚到同一退出观察。 */
  private async doClose(): Promise<void> {
    await this.startPromise?.catch(() => undefined);
    this.dataDisposable?.dispose();
    this.dataDisposable = null;
    const pty = this.pty;
    let failure: unknown;
    if (pty && !this.exitValue) {
      const grace = this.options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
      try {
        if (process.platform === "win32") {
          // Windows 不支持 POSIX 信号语义，直接 kill。
          // 警告：勿绕过 pty.kill() 自行终止进程（如 taskkill）。kill() 会 fork
          // conpty_console_list_agent 枚举控制台进程，真实控制台会话下未修复的
          // node-pty 会崩 AttachConsole——正确修法是升级 node-pty ≥1.2.0 或
          // 消费者侧 pnpm patch；改写拆卸路径曾因 fork 原生签名差异全线回归
          // （见 0.3.1 召回记录）。
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
      } catch (error) {
        failure = error;
      }
    }
    this.permanentExitDisposable?.dispose();
    this.permanentExitDisposable = null;
    this.screenBuffer.dispose();
    this.pty = null;
    this.state = "closed";
    if (failure) throw failure;
  }

  /** 等待已有退出 Promise；超时返回 false，不创建重复监听。 */
  private waitExit(timeoutMs: number): Promise<boolean> {
    if (this.exitValue) return Promise.resolve(true);
    const exitPromise = this.exitPromise;
    if (!exitPromise) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const finish = (exited: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(exited);
      };
      timer = setTimeout(() => finish(false), timeoutMs);
      timer.unref?.();
      void exitPromise.then(() => finish(true));
    });
  }
}
