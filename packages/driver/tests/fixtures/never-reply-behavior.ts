/**
 * @module @x-agent-suite/driver/tests/fixtures/never-reply-behavior
 * 假 peer 行为：握手与告别正常，turn 永不回应，用于验证 close-as-cancel。
 */
import type { FakePeerApi } from "./fake-jsonrpc-peer.ts";

/** 注册永不返回的 turn handler。 */
export default function setup(api: FakePeerApi): void {
  api.onRequest("handshake", () => ({ sessionId: "hang-session" }));
  api.onRequest("finish", () => ({}));
  api.onRequest("turn", () => new Promise(() => {}));
}
