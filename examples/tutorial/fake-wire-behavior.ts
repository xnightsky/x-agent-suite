/**
 * @module examples/tutorial/fake-wire-behavior
 * 06-long-lived-wire 教程的假 peer 行为：虚构通用方法名
 * （handshake / turn / finish / event），不对应任何真实协议。
 * 由 packages/driver/tests/fixtures/fake-jsonrpc-peer.ts 引擎按
 * FAKE_JSONRPC_PEER_BEHAVIOR 环境变量加载。
 * 行为脚本：turn 先推一条轮次内 "event" 通知（{chunk}）再应答；
 * 每轮应答 30ms 后再推一条轮次外 "event" 通知（{idle}），供 inbound 断言。
 */
import type { FakePeerApi } from "../../packages/driver/tests/fixtures/fake-jsonrpc-peer.ts";

/** 注册教程演示行为。 */
export default function setup(api: FakePeerApi): void {
  api.onRequest("handshake", () => ({ sessionId: "tutorial-session" }));
  api.onRequest("finish", () => ({}));
  api.onRequest("turn", (params) => {
    const { text } = params as { text: string };
    api.notify("event", { chunk: `echo:${text}` });
    setTimeout(() => {
      api.notify("event", { idle: true, title: "inbound-arrived" });
    }, 30);
    return { stop: "end" };
  });
}
