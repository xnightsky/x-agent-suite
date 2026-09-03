/**
 * @module examples/tutorial/06-long-lived
 * 消费者侧长驻 driver 最小实现：多轮 inject、入站匹配和幂等关闭。
 */
import type {
  DriverEvent,
  InboundEvent,
  LongLivedAgentDriver,
  Observation,
} from "@x-agent-suite/contracts";
import { AsyncQueue } from "@x-agent-suite/driver";
import { printTutorialSummary } from "./support.ts";

class TutorialLongLivedDriver implements LongLivedAgentDriver {
  readonly injectMode = "followUp" as const;
  private readonly eventQueue = new AsyncQueue<DriverEvent>();
  private readonly inboundQueue = new AsyncQueue<InboundEvent>();
  private started = false;
  private turn = 0;
  private closedValue = false;

  get closed(): boolean {
    return this.closedValue;
  }

  async start(): Promise<void> {
    if (this.started) throw new Error("长驻教程 driver 不允许重复 start");
    this.started = true;
    this.pushEvent("started");
  }

  sendPrompt(text: string): Promise<Observation> {
    return this.inject(text);
  }

  async inject(text: string): Promise<Observation> {
    if (!this.started || this.closedValue) {
      throw new Error("长驻教程 driver 未启动或已关闭");
    }
    this.turn += 1;
    this.pushEvent("prompt", { text, turn: this.turn });
    if (this.turn === 1) {
      this.inboundQueue.push({
        kind: "notification",
        timestamp: Date.now(),
        payload: { afterTurn: 1 },
      });
    }
    const event: DriverEvent = {
      type: "text",
      timestamp: Date.now(),
      payload: { text: `TURN_${this.turn}:${text}` },
    };
    this.eventQueue.push(event);
    return {
      text: `TURN_${this.turn}:${text}`,
      toolCalls: [],
      toolCallsCount: 0,
      events: [event],
    };
  }

  events(): AsyncIterable<DriverEvent> {
    return this.eventQueue;
  }

  inbound(): AsyncIterable<InboundEvent> {
    return this.inboundQueue;
  }

  async waitInbound(
    match: (event: InboundEvent) => boolean,
    timeoutMs: number,
  ): Promise<InboundEvent> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.nextMatchingInbound(match),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`等待入站事件超时（${timeoutMs}ms）`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async close(reason?: string): Promise<void> {
    if (this.closedValue) return;
    this.closedValue = true;
    this.pushEvent("closed", { reason });
    this.eventQueue.end();
    this.inboundQueue.end();
  }

  private async nextMatchingInbound(
    match: (event: InboundEvent) => boolean,
  ): Promise<InboundEvent> {
    for await (const event of this.inboundQueue) {
      if (match(event)) return event;
    }
    throw new Error("入站事件流已结束");
  }

  private pushEvent(type: string, payload?: unknown): void {
    this.eventQueue.push({ type, timestamp: Date.now(), payload });
  }
}

const driver = new TutorialLongLivedDriver();
await driver.start();
let inbound: InboundEvent;
try {
  await driver.inject("first turn");
  inbound = await driver.waitInbound(
    (event) => event.kind === "notification",
    1_000,
  );
  await driver.inject("follow-up");
} finally {
  await driver.close("long-lived tutorial complete");
}

printTutorialSummary({
  recipe: "long-lived",
  turns: 2,
  inboundKind: inbound.kind,
  injectMode: driver.injectMode,
  closed: driver.closed,
});
