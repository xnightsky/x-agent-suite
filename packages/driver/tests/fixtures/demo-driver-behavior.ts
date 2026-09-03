/**
 * @module @x-agent-suite/driver/tests/fixtures/demo-driver-behavior
 * long-lived-jsonrpc.test.ts 的演示行为：虚构通用方法名
 * （handshake / turn / finish / event / ask），不对应任何真实协议。
 * 行为脚本（按 turn 的 text 分派）：
 * - "handshake"：应答 {sessionId}；
 * - "finish"：空应答（close 前的告别请求）；
 * - "turn"：先推一条轮次内 "event" 通知（{chunk}）再应答 {stop}；
 *   text 为 "reverse" 时先发反向请求 "ask" 等应答，再推 chunk 并应答；
 *   text 为 "notify-later" 时先正常应答，50ms 后再推一条轮次外
 *   "event" 通知（{idle}），供 inbound / waitInbound 断言；
 *   text 为 "broken" 时先写一行非法 JSONL 再应答。
 */
import type { FakePeerApi } from "./fake-jsonrpc-peer.ts";

/** 注册演示长驻会话行为。 */
export default function setup(api: FakePeerApi): void {
  api.onRequest("handshake", () => ({ sessionId: "demo-session" }));
  api.onRequest("finish", () => ({}));
  api.onRequest("turn", async (params) => {
    const { text } = params as { text: string };
    if (text === "reverse") {
      const answer = await api.request("ask", { question: "continue?" });
      api.notify("event", { chunk: `answered:${JSON.stringify(answer)}` });
      return { stop: "end" };
    }
    api.notify("event", { chunk: `echo:${text}` });
    if (text === "notify-later") {
      setTimeout(() => {
        api.notify("event", { idle: true, title: "inbound-arrived" });
      }, 50);
    }
    if (text === "broken") {
      api.sendRaw("not json");
    }
    return { stop: "end" };
  });
}
