/**
 * @module @x-agent-suite/driver/proc
 * 子进程基座：spawn 包装、stdout 严格 LF 分帧解析为异步队列、
 * stderr 捕获到环形缓冲（失败诊断）、close 先优雅退出（SIGTERM 或 stdin 关闭）超时后强杀。
 * 不变量：所有错误显式抛带上下文的 Error；close 幂等；
 * win32 无信号语义，优雅路径改为关闭 stdin 请求对端退出，超时后 kill；
 * 分帧只认 \n（U+2028 / U+2029 不断行），由 jsonl-framing 保证。
 */
import { spawn, type ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { LfFramer } from "./jsonl-framing.ts";
import { AsyncQueue } from "./queue.ts";

/** JSONL 子进程拉起选项。 */
export interface SpawnJsonlOptions {
  /** 可执行命令。 */
  readonly command: string;
  /** 命令行参数。 */
  readonly args?: readonly string[];
  /** 工作目录。 */
  readonly cwd?: string;
  /** 环境变量（缺省继承当前进程）。 */
  readonly env?: NodeJS.ProcessEnv;
  /** 优雅退出宽限（毫秒），超时后 SIGKILL；默认 2000。 */
  readonly killGraceMs?: number;
  /** stderr 环形缓冲保留行数；默认 200。 */
  readonly stderrRingLines?: number;
  /**
   * start 成功后立即关闭 stdin（一次性命令用）：部分 CLI
   * 在非 TTY stdin 上会阻塞等待额外输入直到 EOF。
   */
  readonly closeStdinAfterStart?: boolean;
}

const DEFAULT_KILL_GRACE_MS = 2_000;
const DEFAULT_STDERR_RING_LINES = 200;
const DEFAULT_STDERR_LINE_BYTES = 64 * 1024;

function utf8Tail(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maxBytes) return value;
  let start = bytes.length - maxBytes;
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start += 1;
  return bytes.subarray(start).toString("utf8");
}

/**
 * 按行 JSONL 交互的子进程句柄。
 *
 * @behavior jsonl-process-lifecycle
 * Given: 调用方给出 command/args。
 * When: start 后 send 写一行 JSONL、lines() 按序消费 stdout JSONL、close 终止进程。
 * Then: stdout 每行 JSON.parse 后入队；解析失败使 lines() 迭代抛带原文的错；
 * stderr 按行进入环形缓冲，单行/未完成行只保留 64KiB UTF-8 尾部；close 幂等，
 * 先 SIGTERM 超时后 SIGKILL（win32 直接 kill）。
 * Failure: spawn 失败、写入已关闭进程、JSONL 解析失败均显式抛带上下文的 Error。
 */
export class JsonlProcess {
  private readonly options: SpawnJsonlOptions;
  private readonly queue = new AsyncQueue<unknown>();
  private readonly stderrRing: string[] = [];
  private stderrPending = "";
  private child: ChildProcess | null = null;
  private closePromise: Promise<void> | null = null;

  constructor(options: SpawnJsonlOptions) {
    if (!options.command) {
      throw new Error("JsonlProcess: command 不能为空");
    }
    this.options = options;
  }

  /** 子进程 pid（未启动为 undefined）。 */
  get pid(): number | undefined {
    return this.child?.pid;
  }

  /** stderr 环形缓冲拼接文本，用于失败诊断；未遇 LF 的当前行也即时可见。 */
  stderrTail(): string {
    const limit = this.options.stderrRingLines ?? DEFAULT_STDERR_RING_LINES;
    const parts =
      this.stderrPending === ""
        ? this.stderrRing
        : [...this.stderrRing, this.stderrPending];
    return parts.slice(-limit).join("");
  }

  /** 拉起子进程；spawn 失败显式抛错。重复 start 显式抛错。 */
  async start(): Promise<void> {
    if (this.child) {
      throw new Error(
        `JsonlProcess: 重复 start（command=${this.options.command}）`,
      );
    }
    const child = spawn(this.options.command, [...(this.options.args ?? [])], {
      cwd: this.options.cwd,
      env: this.options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", () => resolve());
      child.once("error", (error) => {
        reject(
          new Error(
            `JsonlProcess spawn 失败（${this.options.command}）: ${error.message}`,
          ),
        );
      });
    });
    const stdout = child.stdout;
    const stderr = child.stderr;
    if (!stdout || !stderr) {
      child.kill();
      throw new Error(
        `JsonlProcess: stdio 未按 pipe 打开（command=${this.options.command}）`,
      );
    }
    this.pipeStderr(stderr);
    this.pipeStdout(stdout);
    if (this.options.closeStdinAfterStart) {
      try {
        child.stdin?.end();
      } catch {
        // stdin 已销毁时忽略，不影响 stdout 消费。
      }
    }
  }

  /** 写一行 JSONL 到子进程 stdin；未启动或已关闭显式抛错。 */
  send(message: unknown): void {
    const stdin = this.child?.stdin;
    if (!stdin || stdin.destroyed) {
      throw new Error(
        `JsonlProcess: 进程未运行，无法写入（command=${this.options.command}）`,
      );
    }
    const line = JSON.stringify(message);
    stdin.write(`${line}\n`, (error) => {
      if (error) {
        this.queue.fail(
          new Error(
            `JsonlProcess stdin 写入失败（command=${this.options.command}）: ${error.message}`,
          ),
        );
      }
    });
  }

  /** 按序消费 stdout JSONL 解析结果；进程退出或解析失败后迭代终止。 */
  lines(): AsyncIterable<unknown> {
    return this.queue;
  }

  /** 幂等关闭：先优雅退出（POSIX SIGTERM / win32 关闭 stdin）等待宽限，超时强杀。 */
  async close(): Promise<void> {
    this.closePromise ??= this.doClose();
    return this.closePromise;
  }

  private async doClose(): Promise<void> {
    const child = this.child;
    if (!child) {
      this.queue.end();
      return;
    }
    if (child.exitCode === null && !child.killed) {
      if (process.platform === "win32") {
        // win32 无信号语义：关 stdin 请求对端优雅退出（给对端清理自己子进程的机会），超时后强杀。
        try {
          child.stdin?.end();
        } catch {
          // stdin 已销毁时直接走强杀路径。
        }
        const exited = await this.waitExit(
          child,
          this.options.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
        );
        if (!exited) {
          child.kill();
          await this.waitExit(
            child,
            this.options.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
          );
        }
      } else {
        child.kill("SIGTERM");
        const exited = await this.waitExit(
          child,
          this.options.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
        );
        if (!exited) {
          child.kill("SIGKILL");
          await this.waitExit(
            child,
            this.options.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
          );
        }
      }
    }
    this.child = null;
    this.queue.end();
  }

  /** 等待进程退出，超时返回 false。 */
  private waitExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      if (child.exitCode !== null) {
        resolve(true);
        return;
      }
      const timer = setTimeout(() => {
        child.off("exit", onExit);
        resolve(false);
      }, timeoutMs);
      timer.unref();
      const onExit = () => {
        clearTimeout(timer);
        resolve(true);
      };
      child.once("exit", onExit);
    });
  }

  /** stdout 严格 LF 分帧后 JSON.parse 入队；进程退出后冲刷并结束队列。 */
  private pipeStdout(stdout: Readable): void {
    const framer = new LfFramer((line) => {
      if (line.trim() === "") {
        return;
      }
      try {
        this.queue.push(JSON.parse(line));
      } catch (error) {
        this.queue.fail(
          new Error(
            `JsonlProcess stdout 非 JSON 行（command=${this.options.command}）: ${line}；` +
              `原因: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    });
    stdout.on("data", (chunk: Buffer) => {
      try {
        framer.push(chunk);
      } catch (error) {
        this.queue.fail(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    });
    stdout.on("end", () => {
      framer.end();
      this.queue.end();
    });
  }

  /** stderr 按 LF 分行进入环形缓冲；当前未完成行保持实时可见。 */
  private pipeStderr(stderr: Readable): void {
    const limit = this.options.stderrRingLines ?? DEFAULT_STDERR_RING_LINES;
    const decoder = new StringDecoder("utf8");
    const appendCompleted = (line: string): void => {
      const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
      this.stderrRing.push(
        `${utf8Tail(normalized, DEFAULT_STDERR_LINE_BYTES - 1)}\n`,
      );
      while (this.stderrRing.length > limit) this.stderrRing.shift();
    };
    const flushCompleted = (): void => {
      for (;;) {
        const index = this.stderrPending.indexOf("\n");
        if (index < 0) return;
        appendCompleted(this.stderrPending.slice(0, index));
        this.stderrPending = this.stderrPending.slice(index + 1);
      }
    };
    const trimPending = (): void => {
      this.stderrPending = utf8Tail(
        this.stderrPending,
        DEFAULT_STDERR_LINE_BYTES,
      );
    };
    stderr.on("data", (chunk: Buffer) => {
      this.stderrPending += decoder.write(chunk);
      flushCompleted();
      trimPending();
    });
    stderr.on("end", () => {
      this.stderrPending += decoder.end();
      flushCompleted();
      trimPending();
      if (this.stderrPending !== "") appendCompleted(this.stderrPending);
      this.stderrPending = "";
    });
  }
}
