/**
 * @module @x-agent-suite/driver/jsonrpc-peer
 * 协议无关 JSON-RPC wire 层：在 JsonlProcess 之上提供请求/响应配对、
 * 反向请求分发与通知回调。基于 JsonlProcess 组合（不继承）。
 * 不变量：
 * - 本模块不出现任何具体协议方法名字面量；method 一律由调用方传入；
 * - request 带 id 自增配对，超时显式 reject 并附 stderrTail 诊断；
 * - 消费循环三态路由：有 id 且含 result/error → 响应归位（error 显式 reject）；
 *   有 id 且含 method → 反向请求分发；否则 → 通知回调；无法归类的消息显式失败；
 * - 未注册 handler 的反向请求必须回复 {error: {code: -32601}}，防止对端挂起；
 * - 流断且仍有悬挂请求 / 解析失败 / 无法路由时 failPending：显式拒绝所有悬挂请求；
 *   流自然结束且无悬挂请求属正常结束，不产生失败；
 * - close 幂等（closePromise ??=），顺序：先停消费循环，再关 JsonlProcess。
 */
import { JsonlProcess } from "./proc.ts";

/** 对端发来的 JSON-RPC 反向请求（server→client 方向）。 */
export interface JsonRpcIncomingRequest {
  /** 请求 id（需原样回带应答）。 */
  readonly id: number | string;
  /** 方法名；语义由消费者解释。 */
  readonly method: string;
  /** 请求参数（可选，原始结构）。 */
  readonly params?: unknown;
}

/** 对端发来的 JSON-RPC 通知（无 id）。 */
export interface JsonRpcNotification {
  /** 方法名；语义由消费者解释。 */
  readonly method: string;
  /** 通知参数（可选，原始结构）。 */
  readonly params?: unknown;
}

/** 反向请求的应答决策：handled:false 时由本层回 -32601。 */
export type JsonRpcReverseAnswer =
  | { readonly handled: true; readonly result: unknown }
  | { readonly handled: false };

/** JsonRpcPeer 构造选项。 */
export interface JsonRpcPeerOptions {
  /** 底层 JSONL 子进程句柄（调用方负责 start）。 */
  readonly proc: JsonlProcess;
  /** request 缺省超时（毫秒）；默认 30_000。 */
  readonly defaultTimeoutMs?: number;
}

/** 在飞的 client→server 请求。 */
interface PendingRequest {
  readonly method: string;
  readonly timer: ReturnType<typeof setTimeout>;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

/** 一条待路由的对端消息（宽松视图，路由时再判别形态）。 */
interface WireMessage {
  readonly id?: number | string;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly code?: number; readonly message?: string };
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const REVERSE_METHOD_NOT_FOUND = -32601;
const REVERSE_HANDLER_FAILED = -32603;

/**
 * 协议无关 JSON-RPC 对端：请求配对、反向请求分发、通知回调。
 *
 * @behavior jsonrpc-peer-wire
 * Given: 调用方传入已构造的 JsonlProcess 并注册回调。
 * When: start 后 request 发出请求，对端回响应 / 反向请求 / 通知。
 * Then: 响应按 id 归位；反向请求交给注册 handler，未注册回 -32601；
 *       通知交给通知回调；close 幂等且先停消费再关进程。
 * Failure: 超时、对端 error、流断、解析失败、无法路由的消息均显式抛带上下文的 Error。
 */
export class JsonRpcPeer {
  private readonly proc: JsonlProcess;
  private readonly defaultTimeoutMs: number;
  private readonly pending = new Map<number, PendingRequest>();
  private notificationHandler: ((msg: JsonRpcNotification) => void) | null =
    null;
  private reverseHandler:
    | ((
        msg: JsonRpcIncomingRequest,
      ) => JsonRpcReverseAnswer | Promise<JsonRpcReverseAnswer>)
    | null = null;
  private streamEndHandler: ((error: Error | null) => void) | null = null;
  private rpcId = 0;
  private consumePromise: Promise<void> | null = null;
  private stopConsume: (() => void) | null = null;
  private closePromise: Promise<void> | null = null;

  constructor(options: JsonRpcPeerOptions) {
    this.proc = options.proc;
    this.defaultTimeoutMs =
      options.defaultTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  /** 注册通知回调（消费循环同步调用；抛错将导致 wire 显式失败）。 */
  onNotification(handler: (msg: JsonRpcNotification) => void): void {
    this.notificationHandler = handler;
  }

  /** 注册反向请求 handler；未注册或返回 handled:false 时回 -32601；handler 抛错回 -32603 并带原因（刻意设计：对端必须拿到显式错误而非挂起）。 */
  onReverseRequest(
    handler: (
      msg: JsonRpcIncomingRequest,
    ) => JsonRpcReverseAnswer | Promise<JsonRpcReverseAnswer>,
  ): void {
    this.reverseHandler = handler;
  }

  /** 注册流结束回调：error 为 null 表示正常停止（主动 close，或无悬挂请求的自然流结束）。 */
  onStreamEnd(handler: (error: Error | null) => void): void {
    this.streamEndHandler = handler;
  }

  /** 启动消费循环；重复 start 显式抛错。 */
  start(): void {
    if (this.consumePromise) {
      throw new Error("JsonRpcPeer: 重复 start");
    }
    this.consumePromise = this.consume();
  }

  /** 发一个 client→server 请求并等响应（id 配对，超时显式拒绝）。 */
  request(
    method: string,
    params?: unknown,
    timeoutMs?: number,
  ): Promise<unknown> {
    if (this.closePromise) {
      return Promise.reject(new Error("JsonRpcPeer: 已关闭，不能 request"));
    }
    const id = ++this.rpcId;
    const budget = timeoutMs ?? this.defaultTimeoutMs;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `JsonRpcPeer: 请求 ${method} 超时（${budget}ms）；stderr: ${this.proc.stderrTail().slice(-400)}`,
          ),
        );
      }, budget);
      this.pending.set(id, { method, timer, resolve, reject });
      try {
        this.proc.send({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /** 幂等关闭：先停消费循环，再关 JsonlProcess，最后拒绝残留悬挂请求。 */
  async close(): Promise<void> {
    this.closePromise ??= this.doClose();
    return this.closePromise;
  }

  /** 关闭实现：停消费 → 关进程 → 拒绝残留。 */
  private async doClose(): Promise<void> {
    this.stopConsume?.();
    await this.consumePromise;
    await this.proc.close();
    this.failPending(new Error("JsonRpcPeer: 已关闭"));
  }

  /** 消费 stdout 行流：可被 stopConsume 打断；结束后回调 onStreamEnd。 */
  private async consume(): Promise<void> {
    const iterator = this.proc.lines()[Symbol.asyncIterator]();
    let stopNotified = false;
    const stopSignal = new Promise<"stop">((resolve) => {
      this.stopConsume = () => {
        if (!stopNotified) {
          stopNotified = true;
          resolve("stop");
        }
      };
    });
    let failure: Error | null = null;
    try {
      for (;;) {
        const next = await Promise.race([
          iterator.next().then(
            (result) => ({ kind: "item" as const, result }),
            (error: unknown) => ({ kind: "error" as const, error }),
          ),
          stopSignal.then((signal) => ({ kind: "stop" as const, signal })),
        ]);
        if (next.kind === "stop") break;
        if (next.kind === "error") {
          throw next.error instanceof Error
            ? next.error
            : new Error(String(next.error));
        }
        if (next.result.done) break;
        this.route(next.result.value as WireMessage);
      }
      if (!stopNotified && this.pending.size > 0) {
        failure = new Error("JsonRpcPeer: 对端流已结束，存在未完成的请求");
      }
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
    } finally {
      if (failure) {
        this.failPending(failure);
      }
      this.streamEndHandler?.(failure);
    }
  }

  /** 按 JSON-RPC 三态分发一条消息；无法归类的消息显式失败。 */
  private route(msg: WireMessage): void {
    if (
      msg.id !== undefined &&
      (msg.result !== undefined || msg.error !== undefined)
    ) {
      this.resolvePending(msg);
      return;
    }
    if (msg.id !== undefined && typeof msg.method === "string") {
      void this.answerReverse({
        id: msg.id,
        method: msg.method,
        params: msg.params,
      });
      return;
    }
    if (typeof msg.method === "string") {
      this.notificationHandler?.({ method: msg.method, params: msg.params });
      return;
    }
    throw new Error(
      `JsonRpcPeer: 无法路由的消息形态: ${JSON.stringify(msg)?.slice(0, 200)}`,
    );
  }

  /** 响应归位：按 id 找回调，error 显式 reject。 */
  private resolvePending(msg: WireMessage): void {
    const pending = this.pending.get(Number(msg.id));
    if (!pending) {
      // 未知 id（多为已超时请求迟到应答）：该请求已显式拒绝过，直接丢弃。
      return;
    }
    this.pending.delete(Number(msg.id));
    clearTimeout(pending.timer);
    if (msg.error) {
      pending.reject(
        new Error(
          `JsonRpcPeer: 请求 ${pending.method} 失败: ${msg.error.message ?? JSON.stringify(msg.error)}`,
        ),
      );
      return;
    }
    pending.resolve(msg.result);
  }

  /** 反向请求：分发给注册 handler；未注册回 -32601，handler 失败回 -32603。 */
  private async answerReverse(msg: JsonRpcIncomingRequest): Promise<void> {
    let answer: JsonRpcReverseAnswer = { handled: false };
    if (this.reverseHandler) {
      try {
        answer = await this.reverseHandler(msg);
      } catch (error) {
        this.safeSend({
          jsonrpc: "2.0",
          id: msg.id,
          error: {
            code: REVERSE_HANDLER_FAILED,
            message: `JsonRpcPeer: 反向请求 ${msg.method} 处理失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        });
        return;
      }
    }
    if (answer.handled) {
      this.safeSend({ jsonrpc: "2.0", id: msg.id, result: answer.result });
      return;
    }
    this.safeSend({
      jsonrpc: "2.0",
      id: msg.id,
      error: {
        code: REVERSE_METHOD_NOT_FOUND,
        message: `JsonRpcPeer: 未注册的反向请求方法: ${msg.method}`,
      },
    });
  }

  /** 应答写出；进程已死时显式拒绝悬挂请求而非静默吞错。 */
  private safeSend(message: unknown): void {
    try {
      this.proc.send(message);
    } catch (error) {
      this.failPending(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /** 显式拒绝所有悬挂请求（不静默挂起）。 */
  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
