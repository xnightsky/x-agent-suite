/**
 * @module @x-agent-suite/driver/tests/fixtures/demo-peer-behavior
 * jsonrpc-peer.test.ts 的演示行为：虚构通用方法名（echo / make-reverse 等），
 * 仅用于验证 wire 层机制，不对应任何真实协议。
 * 行为脚本：
 * - "echo"：原样回显 params；
 * - "never-reply"：永不应答（验证客户端超时路径）；
 * - "trigger-notify"：先推一条 "event" 通知再应答；
 * - "make-reverse"：按 params.method 发 server→client 反向请求并等应答，
 *   把对端应答或对端拒绝原因回给客户端；
 * - "broken"：先写一行非法 JSONL 再应答（验证客户端悬挂请求显式失败）。
 */
import type { FakePeerApi } from "./fake-jsonrpc-peer.ts";

/** 注册演示 wire 行为。 */
export default function setup(api: FakePeerApi): void {
  api.onRequest("echo", (params) => params);
  api.onRequest("never-reply", () => new Promise<unknown>(() => {}));
  api.onRequest("trigger-notify", () => {
    api.notify("event", { seq: 1 });
    return { sent: true };
  });
  api.onRequest("make-reverse", async (params) => {
    const { method } = params as { method: string };
    try {
      const answer = await api.request(method, { question: "pick" });
      return { answer };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });
  api.onRequest("broken", () => {
    api.sendRaw("not json");
    return { unreachable: true };
  });
}
