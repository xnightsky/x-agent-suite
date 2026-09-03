/**
 * @module @x-agent-suite/driver/pty-screen
 * PTY 屏幕缓冲：基于 @xterm/headless 虚拟终端，吸收光标移动与重绘，
 * 提供快照与 waitForScreen。
 * 不变量：cols/rows 在构造时固定；snapshot 返回已按行还原的纯文本；
 * waitForScreen 超时显式抛错并附最后一屏；dispose 后不再使用本对象。
 */
import { createRequire } from "node:module";

// @xterm/headless 为 CommonJS 包且无 ESM wrapper，通过 createRequire 加载以避免
// tsx / Node ESM 对 CJS 命名空间导出的不一致行为。
// 同时声明最小运行时接口，避免根 tsconfig 解析 @xterm/headless 类型包。
interface XtermTerminal {
  write(data: string | Uint8Array): void;
  readonly buffer: {
    readonly active: {
      readonly length: number;
      getLine(
        y: number,
      ): { translateToString(trimRight?: boolean): string } | undefined;
    };
  };
  readonly cols: number;
  readonly rows: number;
  readonly cursorX: number;
  readonly cursorY: number;
  onData: (listener: (data: string) => unknown) => { dispose(): void };
  dispose(): void;
}

const require = createRequire(import.meta.url);
const xterm = require("@xterm/headless") as {
  Terminal: new (options: Record<string, unknown>) => XtermTerminal;
};

/** 默认终端尺寸与 TERM 值。 */
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/** 屏幕缓冲选项。 */
export interface PtyScreenOptions {
  /** 列数；默认 80。 */
  readonly cols?: number;
  /** 行数；默认 24。 */
  readonly rows?: number;
  /** TERM 环境变量；仅作记录，真实 TERM 由 PtyProcess 注入子进程 env。 */
  readonly term?: string;
}

/** 光标位置。 */
export interface CursorPosition {
  /** 列索引（0-based）。 */
  readonly x: number;
  /** 行索引（0-based，相对 buffer.active）。 */
  readonly y: number;
}

/** PTY 屏幕缓冲句柄。 */
export interface PtyScreen {
  /** 写入 PTY 原始输出。 */
  feed(data: string | Buffer): void;
  /** 当前屏幕快照（按行拼接，LF 分隔）。 */
  snapshot(): string;
  /** 当前光标位置。 */
  cursor(): CursorPosition;
  /** 等待快照匹配正则；超时抛错附最后一屏。 */
  waitForScreen(match: RegExp, timeoutMs: number): Promise<void>;
  /** 订阅屏幕变化（有新数据写入时触发）。返回取消订阅函数。 */
  onChange(listener: () => void): () => void;
  /** 释放虚拟终端资源。 */
  dispose(): void;
}

/**
 * 创建基于 @xterm/headless 的屏幕缓冲。
 *
 * @behavior pty-screen-contract
 * Given: 调用方构造 PtyScreen 并持续 feed PTY 输出。
 * When: 调用 snapshot / waitForScreen / dispose。
 * Then: snapshot 返回当前视口与滚动历史的按行文本；waitForScreen 在匹配到内容时 resolve，
 * 超时 reject 并附最后一屏；dispose 释放底层 Terminal。
 * Failure: feed 入已 dispose 对象行为未定义，应由调用方避免。
 */
export function createPtyScreen(options?: PtyScreenOptions): PtyScreen {
  return new PtyScreenImpl(options);
}

class PtyScreenImpl implements PtyScreen {
  private readonly terminal: XtermTerminal;
  private readonly listeners = new Set<() => void>();
  private disposed = false;

  constructor(options: PtyScreenOptions = {}) {
    this.terminal = new xterm.Terminal({
      cols: options.cols ?? DEFAULT_COLS,
      rows: options.rows ?? DEFAULT_ROWS,
      allowProposedApi: true,
      logLevel: "off",
      // 禁用屏幕阅读器与自定义字形以提升纯文本快照性能。
      screenReaderMode: false,
      customGlyphs: false,
    });
    this.terminal.onData(() => this.emitChange());
  }

  /** 写入 PTY 原始输出；Buffer 会按 UTF-8 解码。 */
  feed(data: string | Buffer): void {
    if (this.disposed) {
      return;
    }
    const text = typeof data === "string" ? data : data.toString("utf8");
    this.terminal.write(text);
    this.emitChange();
  }

  private emitChange(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // 监听器错误不应影响屏幕缓冲本身。
      }
    }
  }

  /** 当前光标位置。 */
  cursor(): CursorPosition {
    return { x: this.terminal.cursorX, y: this.terminal.cursorY };
  }

  /** 订阅屏幕变化；返回取消订阅函数。 */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 当前屏幕快照：从 buffer.active 按行读取并拼接。 */
  snapshot(): string {
    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];
    for (let y = 0; y < buffer.length; y++) {
      const line = buffer.getLine(y);
      if (line) {
        lines.push(line.translateToString(true));
      }
    }
    return lines.join("\n");
  }

  /**
   * 等待屏幕出现匹配内容。
   *
   * @param match 用于匹配快照的正则。
   * @param timeoutMs 超时毫秒数。
   * @throws 超时 Error，携带最后一屏文本。
   */
  waitForScreen(match: RegExp, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.disposed) {
        reject(new Error("PtyScreen: 已 dispose，禁止 waitForScreen"));
        return;
      }

      let resolved = false;
      const check = () => match.test(this.snapshot());
      if (check()) {
        resolve();
        return;
      }

      const interval = setInterval(() => {
        if (resolved) {
          return;
        }
        if (check()) {
          resolved = true;
          clearInterval(interval);
          clearTimeout(timer);
          resolve();
        }
      }, 50);

      const timer = setTimeout(() => {
        if (resolved) {
          return;
        }
        resolved = true;
        clearInterval(interval);
        reject(
          new Error(
            `等待屏幕内容超时（${timeoutMs}ms），最后一屏：\n${this.snapshot()}`,
          ),
        );
      }, timeoutMs);
      timer.unref?.();
    });
  }

  /** 释放虚拟终端资源。 */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.terminal.dispose();
  }
}
