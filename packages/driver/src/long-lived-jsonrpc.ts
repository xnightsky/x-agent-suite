/**
 * @module @x-agent-suite/driver/long-lived-jsonrpc
 * LongLivedAgentDriver 骨架：组合 JsonlProcess + JsonRpcPeer，
 * 协议差异全部收敛到消费者注入的 JsonRpcLongLivedAdapter。
 * 不变量：
 * - 本模块不出现任何具体协议方法名字面量；握手序列、prompt 报文、
 *   反向请求应答、通知归一均由 adapter 决定；
 * - injectMode 构造后固定（readonly），运行中不得切换；
 * - prompt 轮次串行（roundChain）：同一时刻至多一个轮次请求在飞，
 *   前一轮失败不阻塞后续轮次；
 * - 轮次内通知经 mapNotification 归当轮 Observation；轮次外通知进 inbound 队列；
 *   轮次外被映射为 round 的通知显式抛错（刻意设计：归一逻辑必须区分轮次内外）；
 * - waitInbound 只等未来事件，无历史回放；超时显式抛错；
 * - close 幂等：先等在飞轮次收尾（roundChain 不 reject，无死锁），
 *   再发 best-effort 告别请求（adapter.closeRequest）后关 peer；
 *   关闭后 inject/sendPrompt/waitInbound 显式抛错。
 */
import type {
  DriverEvent,
  InboundEvent,
  InjectMode,
  LongLivedAgentDriver,
  Observation,
  ToolCall,
} from "@x-agent-suite/contracts";
import {
  JsonRpcPeer,
  type JsonRpcIncomingRequest,
  type JsonRpcNotification,
  type JsonRpcReverseAnswer,
} from "./jsonrpc-peer.ts";
import { JsonlProcess, type SpawnJsonlOptions } from "./proc.ts";
import { AsyncQueue } from "./queue.ts";

/** 一条 JSON-RPC 请求报文的 method/params 对（消费者构造）。 */
export interface JsonRpcRequestSpec {
  /** 方法名；语义由消费者协议定义。 */
  readonly method: string;
  /** 请求参数（可选）。 */
  readonly params?: unknown;
}

/** 通知归一结果：归当轮聚合 / 转入站事件 / 忽略。 */
export type NotificationMapping =
  | {
      /** 归当轮：记入当轮事件流并参与 Observation 聚合。 */
      readonly kind: "round";
      /** 当轮事件流中的类别名。 */
      readonly eventType: string;
      /** 事件载荷（原始归一数据，可选）。 */
      readonly payload?: unknown;
      /** 追加到当轮文本的片段（可选，按序拼接）。 */
      readonly text?: string;
      /** 追加到当轮工具调用（可选；合并去重由 adapter 内部状态负责）。 */
      readonly toolCall?: ToolCall;
    }
  | {
      /** 入站：作为 InboundEvent 进入 inbound 队列并唤醒 waitInbound。 */
      readonly kind: "inbound";
      /** 完整入站事件（含 timestamp，由 adapter 盖戳）。 */
      readonly event: InboundEvent;
    }
  | {
      /** 忽略：与本框架语义无关的通知。 */
      readonly kind: "ignore";
    };

/**
 * 长驻 JSON-RPC 协议适配接缝：消费者把协议专有语义收敛到这里。
 *
 * adapter 实例可持有跨调用状态（如当轮聚合器）；buildPrompt 每轮调用一次，
 * 可作为轮次边界重置内部状态的时机。handshake / buildPrompt / mapNotification
 * 抛错将显式失败（轮次失败或 wire 失败），不会被静默吞掉。
 */
export interface JsonRpcLongLivedAdapter {
  /**
   * 握手序列与会话句柄提取：start 时调用一次，返回值作为 session
   * 回传给后续 buildPrompt / closeRequest。内部通过 peer.request 完成。
   */
  handshake(peer: JsonRpcPeer): Promise<unknown>;
  /** 构造一轮 prompt 的请求报文；session 为 handshake 返回值。 */
  buildPrompt(
    session: unknown,
    text: string,
    mode: InjectMode,
  ): JsonRpcRequestSpec;
  /**
   * 应答对端反向请求（可选）：返回 handled:false 时 wire 层回 -32601。
   * 未声明该方法时所有反向请求均回 -32601；handler 抛错时 wire 层回 -32603
   * 并带原因（刻意设计：对端必须拿到显式错误而非挂起）。
   */
  answerReverseRequest?(
    msg: JsonRpcIncomingRequest,
  ): JsonRpcReverseAnswer | Promise<JsonRpcReverseAnswer>;
  /**
   * 把一条通知归一为当轮聚合数据 / 入站事件 / 忽略。
   * 注意（刻意设计，非遗漏）：轮次外到达的通知若被映射为 round，
   * driver 将显式抛错——归一逻辑必须自行区分轮次内外。
   */
  mapNotification(msg: JsonRpcNotification): NotificationMapping;
  /**
   * 可选：close 前的告别请求（best-effort，失败不阻塞清理）。
   * 返回 null 表示无告别请求。
   */
  closeRequest?(session: unknown): JsonRpcRequestSpec | null;
}

/** LongLivedJsonRpcDriver 构造选项。 */
export interface LongLivedJsonRpcDriverOptions {
  /** 子进程拉起描述（command/args 由消费者直接给出，sandbox 编排不进这里）。 */
  readonly spawn: SpawnJsonlOptions;
  /** 协议适配接缝。 */
  readonly adapter: JsonRpcLongLivedAdapter;
  /** 固定注入语义；构造后不可变。 */
  readonly injectMode: InjectMode;
  /** 单轮 prompt 请求超时（毫秒）；默认 120_000。 */
  readonly requestTimeoutMs?: number;
}

/** 当轮聚合状态。 */
interface RoundState {
  readonly eventsStart: number;
  readonly texts: string[];
  readonly toolCalls: ToolCall[];
}

/** waitInbound 等待者。 */
interface InboundWaiter {
  readonly match: (event: InboundEvent) => boolean;
  readonly timer: ReturnType<typeof setTimeout>;
  resolve: (event: InboundEvent) => void;
  reject: (error: Error) => void;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const CLOSE_REQUEST_TIMEOUT_MS = 2_000;

/**
 * JSON-RPC 长驻会话驱动骨架：实现 LongLivedAgentDriver。
 *
 * @behavior long-lived-jsonrpc-driver
 * Given: 调用方给出 spawn 描述与协议 adapter。
 * When: start 拉起进程并完成握手；多次 inject 驱动同一会话；close 收尾。
 * Then: inject 轮次串行且各返回独立 Observation；轮次外通知按序进 inbound；
 *       close 幂等，关闭后 inject/sendPrompt/waitInbound 显式抛错。
 * Failure: 握手失败、轮次超时、流断、close 后调用均显式抛带上下文的 Error。
 */
export class LongLivedJsonRpcDriver implements LongLivedAgentDriver {
  /** 本 driver 固定使用的注入语义；构造后不可变。 */
  readonly injectMode: InjectMode;

  private readonly adapter: JsonRpcLongLivedAdapter;
  private readonly proc: JsonlProcess;
  private readonly peer: JsonRpcPeer;
  private readonly requestTimeoutMs: number;
  private readonly eventLog: DriverEvent[] = [];
  private readonly eventQueue = new AsyncQueue<DriverEvent>();
  private readonly inboundQueue = new AsyncQueue<InboundEvent>();
  private readonly inboundWaiters: InboundWaiter[] = [];
  private sessionValue: unknown = null;
  private round: RoundState | null = null;
  private roundChain: Promise<unknown> = Promise.resolve();
  private started = false;
  private closePromise: Promise<void> | null = null;

  constructor(options: LongLivedJsonRpcDriverOptions) {
    this.adapter = options.adapter;
    this.injectMode = options.injectMode;
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.proc = new JsonlProcess(options.spawn);
    this.peer = new JsonRpcPeer({ proc: this.proc });
    this.peer.onNotification((msg) => this.handleNotification(msg));
    this.peer.onReverseRequest(
      (msg) => this.adapter.answerReverseRequest?.(msg) ?? { handled: false },
    );
    this.peer.onStreamEnd((error) => this.handleStreamEnd(error));
  }

  /** 启动：拉起进程 → 起消费循环 → adapter.handshake；握手失败清理后重抛。 */
  async start(): Promise<void> {
    if (this.started) {
      throw new Error("LongLivedJsonRpcDriver: 重复 start");
    }
    this.started = true;
    await this.proc.start();
    this.peer.start();
    try {
      this.sessionValue = await this.adapter.handshake(this.peer);
    } catch (error) {
      await this.peer.close();
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  /** 发送一条用户 prompt（首轮与一次性模式语义一致，委托 inject）。 */
  sendPrompt(text: string): Promise<Observation> {
    return this.enqueuePrompt(text);
  }

  /** 向存活会话注入一条 prompt；轮次串行，前一轮失败不阻塞后续轮次。 */
  inject(text: string): Promise<Observation> {
    return this.enqueuePrompt(text);
  }

  /** 按序暴露入站事件流；close 后迭代结束。 */
  inbound(): AsyncIterable<InboundEvent> {
    return this.inboundQueue;
  }

  /** 按序暴露底层事件流；close 后迭代结束。 */
  events(): AsyncIterable<DriverEvent> {
    return this.eventQueue;
  }

  /** 等待满足条件的入站事件（只等未来事件）；超时显式抛错。 */
  waitInbound(
    match: (event: InboundEvent) => boolean,
    timeoutMs: number,
  ): Promise<InboundEvent> {
    if (this.closePromise) {
      return Promise.reject(
        new Error("LongLivedJsonRpcDriver: 已关闭，不能 waitInbound"),
      );
    }
    return new Promise<InboundEvent>((resolve, reject) => {
      const waiter: InboundWaiter = {
        match,
        timer: setTimeout(() => {
          const index = this.inboundWaiters.indexOf(waiter);
          if (index >= 0) {
            this.inboundWaiters.splice(index, 1);
          }
          reject(
            new Error(
              `LongLivedJsonRpcDriver: waitInbound 超时（${timeoutMs}ms）`,
            ),
          );
        }, timeoutMs),
        resolve,
        reject,
      };
      this.inboundWaiters.push(waiter);
    });
  }

  /** 进程 stderr 尾部（失败诊断用；无则空串）。 */
  stderrTail(): string {
    return this.proc.stderrTail();
  }

  /** 幂等关闭：best-effort 告别请求后关 peer（停消费 → 关进程）。 */
  async close(_reason?: string): Promise<void> {
    this.closePromise ??= this.doClose();
    return this.closePromise;
  }

  /** 关闭实现：等在飞轮次收尾 → 告别请求（best-effort）→ 关 peer → 拒绝残留等待方。 */
  private async doClose(): Promise<void> {
    // roundChain 由 enqueuePrompt 兜底 catch，await 它不会在轮次失败时死锁或重抛。
    await this.roundChain;
    const closeSpec = this.sessionValue
      ? (this.adapter.closeRequest?.(this.sessionValue) ?? null)
      : null;
    if (closeSpec) {
      await this.peer
        .request(closeSpec.method, closeSpec.params, CLOSE_REQUEST_TIMEOUT_MS)
        .catch(() => {
          // best-effort：对端不应答告别请求不阻塞清理。
        });
    }
    await this.peer.close();
    this.rejectInboundWaiters(new Error("LongLivedJsonRpcDriver: 已关闭"));
  }

  /** 轮次串行化入口：关后显式抛错，未 start 显式抛错。 */
  private enqueuePrompt(text: string): Promise<Observation> {
    if (this.closePromise) {
      return Promise.reject(
        new Error("LongLivedJsonRpcDriver: 已关闭，不能 inject/sendPrompt"),
      );
    }
    if (!this.sessionValue) {
      return Promise.reject(
        new Error("LongLivedJsonRpcDriver: start 之前不能 inject/sendPrompt"),
      );
    }
    const run = this.roundChain.then(() => this.promptRound(text));
    this.roundChain = run.catch(() => {});
    return run;
  }

  /** 执行一轮 prompt 请求并聚合当轮 Observation。 */
  private async promptRound(text: string): Promise<Observation> {
    const round: RoundState = {
      eventsStart: this.eventLog.length,
      texts: [],
      toolCalls: [],
    };
    this.round = round;
    try {
      const spec = this.adapter.buildPrompt(
        this.sessionValue,
        text,
        this.injectMode,
      );
      const response = await this.peer.request(
        spec.method,
        spec.params,
        this.requestTimeoutMs,
      );
      this.pushEvent("prompt_result", response);
    } finally {
      this.round = null;
    }
    return {
      text: round.texts.join(""),
      toolCalls: round.toolCalls,
      toolCallsCount: round.toolCalls.length,
      events: this.eventLog.slice(round.eventsStart),
    };
  }

  /** 通知分流：经 adapter 归一后归当轮 / 转入站 / 忽略。 */
  private handleNotification(msg: JsonRpcNotification): void {
    const mapping = this.adapter.mapNotification(msg);
    if (mapping.kind === "ignore") {
      return;
    }
    if (mapping.kind === "inbound") {
      this.pushEvent(mapping.event.kind, mapping.event.payload);
      this.emitInbound(mapping.event);
      return;
    }
    this.pushEvent(mapping.eventType, mapping.payload);
    const round = this.round;
    if (!round) {
      throw new Error(
        "LongLivedJsonRpcDriver: 轮次外通知被 adapter 映射为 round",
      );
    }
    if (mapping.text !== undefined) {
      round.texts.push(mapping.text);
    }
    if (mapping.toolCall !== undefined) {
      round.toolCalls.push(mapping.toolCall);
    }
  }

  /** 入站事件入队并唤醒命中的 waitInbound 等待者。 */
  private emitInbound(event: InboundEvent): void {
    this.inboundQueue.push(event);
    for (let i = this.inboundWaiters.length - 1; i >= 0; i--) {
      const waiter = this.inboundWaiters[i];
      if (waiter && waiter.match(event)) {
        this.inboundWaiters.splice(i, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(event);
      }
    }
  }

  /** 流结束收尾：拒绝 inbound 等待方（显式，不静默挂起），结束队列。 */
  private handleStreamEnd(error: Error | null): void {
    const failure =
      error ??
      (this.closePromise
        ? new Error("LongLivedJsonRpcDriver: 已关闭")
        : new Error("LongLivedJsonRpcDriver: 对端流意外结束"));
    this.rejectInboundWaiters(failure);
    this.inboundQueue.end();
    this.eventQueue.end();
  }

  /** 拒绝所有 waitInbound 等待方并清空。 */
  private rejectInboundWaiters(error: Error): void {
    for (const waiter of this.inboundWaiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  /** 盖戳一条 DriverEvent 入日志与事件流。 */
  private pushEvent(type: string, payload: unknown): void {
    const event: DriverEvent = { type, timestamp: Date.now(), payload };
    this.eventLog.push(event);
    this.eventQueue.push(event);
  }
}
