/**
 * @module @x-agent-suite/harness/pty-watcher
 * PTY 屏幕 idle 判定器：聚合屏幕差异、I/O 静默、光标提示符与 FS 变更频率，
 * 输出多维度 idle 原因。
 * 不变量：
 * - 屏幕 idle 以剔除 spinner/动画帧后的归一化文本为准；
 * - I/O 静默是必要条件，避免在流式输出中途误判；
 * - prompt 匹配作为快速路径，仍需 I/O 静默与光标稳定；
 * - 硬超时始终兜底，返回原因 "timeout"；
 * - dispose 会拒绝全部活动等待，且禁止再调用 waitForIdle。
 */
import type { CursorPosition, PtyProcess } from "@x-agent-suite/driver";

/** 文件变更频率监视器：返回最近一次文件变更时间戳（epoch ms），无变更为 undefined。 */
export interface FsChangeWatcher {
  lastChangedAt(): number | undefined;
}

/** PtyScreenWatcher 选项。 */
export interface PtyScreenWatcherOptions {
  /** PTY 句柄。 */
  readonly pty: PtyProcess;
  /** 需从屏幕差异中剔除的 spinner/动画正则列表。 */
  readonly idlePatterns?: readonly RegExp[];
  /** 输入提示符正则；匹配时光标回到提示符可提前判定 idle。 */
  readonly promptPattern?: RegExp;
  /** 可选的文件变更频率监视器。 */
  readonly fsWatcher?: FsChangeWatcher;
  /** 屏幕文本稳定所需毫秒；默认 1500。 */
  readonly screenIdleMs?: number;
  /** I/O 静默所需毫秒；默认 500。 */
  readonly ioIdleMs?: number;
  /** 光标在提示符处稳定所需毫秒；默认 1000。 */
  readonly promptStabilizeMs?: number;
  /** 文件系统无变更所需毫秒；默认 1000。 */
  readonly fsIdleMs?: number;
  /** 硬超时毫秒；默认 120000。 */
  readonly hardTimeoutMs?: number;
  /** 判定轮询间隔毫秒；默认 100。 */
  readonly pollIntervalMs?: number;
}

/** Idle 判定结果。 */
export interface PtyIdleResult {
  /** 触发判定的维度。 */
  readonly reason: "screen" | "io" | "prompt" | "fs" | "timeout";
  /** 判定时的屏幕快照。 */
  readonly screen: string;
  /** 判定时的光标位置。 */
  readonly cursor: CursorPosition;
  /** 实际等待毫秒。 */
  readonly waitedMs: number;
}

/** PTY 屏幕 idle 判定器句柄。 */
export interface PtyScreenWatcher {
  /** 等待多维 idle 条件满足；dispose 后抛错。 */
  waitForIdle(): Promise<PtyIdleResult>;
  /** 释放监听器与定时器。 */
  dispose(): void;
}

const DEFAULT_SCREEN_IDLE_MS = 1_500;
const DEFAULT_IO_IDLE_MS = 500;
const DEFAULT_PROMPT_STABILIZE_MS = 1_000;
const DEFAULT_FS_IDLE_MS = 1_000;
const DEFAULT_HARD_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 100;

/**
 * 创建 PTY 屏幕 idle 判定器。
 *
 * @behavior pty-watcher-contract
 * Given: 调用方持有已启动的 PtyProcess。
 * When: 调用 waitForIdle 后，PTY 持续输出。
 * Then: 当屏幕文本稳定、I/O 静默、光标回到提示符或文件系统稳定时 resolve；
 * 硬超时返回 reason="timeout"。
 * Failure: dispose 后再调用抛错；PTY 已关闭时行为未定义。
 */
export function createPtyScreenWatcher(
  options: PtyScreenWatcherOptions,
): PtyScreenWatcher {
  return new PtyScreenWatcherImpl(options);
}

/** 获取光标所在行文本（按 \n 分割，越界返回空串）。 */
function cursorLine(screen: string, cursor: CursorPosition): string {
  const lines = screen.split("\n");
  return lines[cursor.y] ?? "";
}

/** 用 idlePatterns 剔除屏幕中的 spinner/动画帧。 */
function normalizeScreen(screen: string, patterns: readonly RegExp[]): string {
  let normalized = screen;
  for (const pattern of patterns) {
    normalized = normalized.replace(pattern, "");
  }
  return normalized;
}

class PtyScreenWatcherImpl implements PtyScreenWatcher {
  private readonly pty: PtyProcess;
  private readonly idlePatterns: readonly RegExp[];
  private readonly promptPattern?: RegExp;
  private readonly fsWatcher?: FsChangeWatcher;
  private readonly screenIdleMs: number;
  private readonly ioIdleMs: number;
  private readonly promptStabilizeMs: number;
  private readonly fsIdleMs: number;
  private readonly hardTimeoutMs: number;
  private readonly pollIntervalMs: number;

  private disposed = false;
  private readonly cancelWaits = new Set<() => void>();
  private readonly unsubscribe: () => void;
  private lastDataAt = 0;
  private lastStableNormalized = "";
  private lastStableAt = 0;
  private lastCursor: CursorPosition = { x: 0, y: 0 };
  private cursorStableSince = 0;
  private lastFsChangedAt?: number;

  constructor(options: PtyScreenWatcherOptions) {
    this.pty = options.pty;
    this.idlePatterns = options.idlePatterns ?? [];
    this.promptPattern = options.promptPattern;
    this.fsWatcher = options.fsWatcher;
    this.screenIdleMs = options.screenIdleMs ?? DEFAULT_SCREEN_IDLE_MS;
    this.ioIdleMs = options.ioIdleMs ?? DEFAULT_IO_IDLE_MS;
    this.promptStabilizeMs =
      options.promptStabilizeMs ?? DEFAULT_PROMPT_STABILIZE_MS;
    this.fsIdleMs = options.fsIdleMs ?? DEFAULT_FS_IDLE_MS;
    this.hardTimeoutMs = options.hardTimeoutMs ?? DEFAULT_HARD_TIMEOUT_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

    const now = Date.now();
    this.lastDataAt = now;
    this.lastStableAt = now;
    this.cursorStableSince = now;
    this.lastCursor = this.pty.cursor();
    this.lastStableNormalized = normalizeScreen(
      this.pty.screen(),
      this.idlePatterns,
    );
    this.lastFsChangedAt = this.fsWatcher?.lastChangedAt();

    this.unsubscribe = this.pty.onScreenChange(() => this.handleChange());
  }

  /** 每次屏幕变化时更新 I/O 与稳定态时间戳。 */
  private handleChange(): void {
    if (this.disposed) return;
    const now = Date.now();
    this.lastDataAt = now;

    const screen = this.pty.screen();
    const normalized = normalizeScreen(screen, this.idlePatterns);
    if (normalized !== this.lastStableNormalized) {
      this.lastStableNormalized = normalized;
      this.lastStableAt = now;
    }

    const cursor = this.pty.cursor();
    if (cursor.x !== this.lastCursor.x || cursor.y !== this.lastCursor.y) {
      this.lastCursor = cursor;
      this.cursorStableSince = now;
    }

    this.lastFsChangedAt = this.fsWatcher?.lastChangedAt();
  }

  waitForIdle(): Promise<PtyIdleResult> {
    if (this.disposed) {
      return Promise.reject(
        new Error("PtyScreenWatcher: 已 dispose，禁止 waitForIdle"),
      );
    }

    return new Promise<PtyIdleResult>((resolve, reject) => {
      const startedAt = Date.now();
      let settled = false;
      let interval: ReturnType<typeof setInterval>;
      let hardTimer: ReturnType<typeof setTimeout>;

      const cleanup = (): void => {
        clearInterval(interval);
        clearTimeout(hardTimer);
        this.cancelWaits.delete(cancel);
      };

      const finish = (reason: PtyIdleResult["reason"]): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({
          reason,
          screen: this.pty.screen(),
          cursor: this.pty.cursor(),
          waitedMs: Date.now() - startedAt,
        });
      };

      const cancel = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("PtyScreenWatcher: dispose 已终止 waitForIdle"));
      };

      const check = (): void => {
        const now = Date.now();
        const ioIdle = now - this.lastDataAt >= this.ioIdleMs;
        const screenIdle = now - this.lastStableAt >= this.screenIdleMs;
        const fsChangedAt =
          this.fsWatcher?.lastChangedAt() ?? this.lastFsChangedAt;
        const fsIdle =
          fsChangedAt === undefined || now - fsChangedAt >= this.fsIdleMs;

        // prompt 快速路径：光标稳定在提示符行且 I/O 静默。
        if (ioIdle && this.promptPattern) {
          const line = cursorLine(this.pty.screen(), this.pty.cursor());
          const promptMatched = this.promptPattern.test(line);
          const promptStable =
            now - this.cursorStableSince >= this.promptStabilizeMs;
          if (promptMatched && promptStable) {
            finish("prompt");
            return;
          }
        }

        // 屏幕稳定 + I/O 静默即可判定；FS 仅作为附加维度，不要求一定有 FS watcher。
        if (screenIdle && ioIdle) {
          finish(fsIdle ? "fs" : "screen");
          return;
        }
      };

      this.cancelWaits.add(cancel);
      interval = setInterval(check, this.pollIntervalMs);
      hardTimer = setTimeout(() => finish("timeout"), this.hardTimeoutMs);
      hardTimer.unref?.();

      // 立即检查一次，避免已经 idle 的场景空等一个轮询。
      check();
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const cancel of [...this.cancelWaits]) cancel();
    this.unsubscribe();
  }
}
