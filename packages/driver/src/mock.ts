/**
 * @module @x-agent-suite/driver/mock
 * 进程内 MockDriver：实现 AgentDriver，用于框架自测。
 * 不变量：sendPrompt 回显文本并按序记录事件（prompt → text）；close 幂等；
 * 关闭后 sendPrompt 显式抛错；事件流在 close 后正常结束。
 */
import type {
  AgentDriver,
  DriverEvent,
  Observation,
} from "@x-agent-suite/contracts";
import { AsyncQueue } from "./queue.ts";

/**
 * Mock driver：不拉起任何子进程，回显 prompt 文本。
 *
 * @behavior mock-driver-echo
 * Given: 调用方 new MockDriver() 并 start。
 * When: sendPrompt(text)。
 * Then: Observation.text 原样回显，toolCalls 为空、toolCallsCount 为 0、steps 为 1；
 * 事件流按序产出 prompt、text 事件。
 * Failure: 未 start 或已 close 后 sendPrompt 显式抛带上下文的 Error。
 */
export class MockDriver implements AgentDriver {
  private readonly queue = new AsyncQueue<DriverEvent>();
  private started = false;
  private closed = false;

  /** 拉起 mock（幂等，无真实进程）。 */
  async start(): Promise<void> {
    if (this.closed) {
      throw new Error("MockDriver: 已关闭，禁止重新 start");
    }
    this.started = true;
  }

  /** 回显 prompt，返回结构化 Observation。 */
  async sendPrompt(text: string): Promise<Observation> {
    if (!this.started) {
      throw new Error("MockDriver: 未 start，禁止 sendPrompt");
    }
    if (this.closed) {
      throw new Error(
        `MockDriver: 已 closed，禁止 sendPrompt（text=${JSON.stringify(text)}）`,
      );
    }
    const events: DriverEvent[] = [
      { type: "prompt", timestamp: Date.now(), payload: { text } },
      { type: "text", timestamp: Date.now(), payload: { text } },
    ];
    for (const event of events) {
      this.queue.push(event);
    }
    return { text, toolCalls: [], toolCallsCount: 0, steps: 1, events };
  }

  /** 按序暴露事件流；close 后迭代结束。 */
  events(): AsyncIterable<DriverEvent> {
    return this.queue;
  }

  /** 幂等关闭：记录 closed 事件并结束事件流。 */
  async close(reason?: string): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.started) {
      this.queue.push({
        type: "closed",
        timestamp: Date.now(),
        payload: { reason: reason ?? null },
      });
    }
    this.queue.end();
  }
}
