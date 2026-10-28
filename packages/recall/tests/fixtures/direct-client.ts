/**
 * @module recall/tests/fixtures/direct-client
 * 消费者临时 Client 的最小 direct Adapter；只调用测试注入的 transport。
 */
import type { AgentDriver } from "@x-agent-suite/contracts";
import type { LiveBackend, LiveMessage } from "@x-agent-suite/llm-fixture";

/** 创建保留多轮消息的合成 Client，不读取宿主配置。 */
export function createDirectClient(backend: LiveBackend): AgentDriver {
  const messages: LiveMessage[] = [];
  return {
    get redactor() {
      return backend.redactor;
    },
    async start() {
      await backend.start();
    },
    async sendPrompt(text) {
      messages.push({ role: "user", text });
      const response = await backend.complete({ messages });
      messages.push({ role: "assistant", text: response.text });
      return {
        text: response.text,
        toolCalls: [],
        toolCallsCount: 0,
        steps: 1,
        events: [],
      };
    },
    async *events() {},
    async close() {
      await backend.stop();
    },
  };
}
