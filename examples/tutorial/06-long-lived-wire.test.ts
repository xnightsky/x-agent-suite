/**
 * @module examples/tutorial/06-long-lived-wire
 * JSON-RPC wire 层完整链路：假 peer 子进程 + JsonRpcPeer + LongLivedJsonRpcDriver，
 * 协议差异全部落在消费者侧 adapter（本文件中的演示 adapter 用虚构方法名）。
 * fake peer 引擎来自 packages/driver/tests/fixtures/fake-jsonrpc-peer.ts，
 * 行为脚本见 ./fake-wire-behavior.ts。
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LongLivedJsonRpcDriver,
  type JsonRpcLongLivedAdapter,
  type NotificationMapping,
} from "@x-agent-suite/driver";
import { printTutorialSummary } from "./support.ts";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE_PEER = join(
  here,
  "..",
  "..",
  "packages",
  "driver",
  "tests",
  "fixtures",
  "fake-jsonrpc-peer.ts",
);
const BEHAVIOR = join(here, "fake-wire-behavior.ts");

/** 演示 adapter：handshake 提取会话句柄，turn 轮次，event 通知归一。 */
const adapter: JsonRpcLongLivedAdapter = {
  async handshake(peer) {
    const result = (await peer.request("handshake", { version: 1 }, 5_000)) as {
      sessionId?: string;
    };
    if (!result.sessionId) {
      throw new Error(`握手响应缺 sessionId: ${JSON.stringify(result)}`);
    }
    return { sessionId: result.sessionId };
  },
  buildPrompt: (session, text) => ({
    method: "turn",
    params: { session, text },
  }),
  mapNotification(msg): NotificationMapping {
    if (msg.method !== "event") {
      return { kind: "ignore" };
    }
    const params = (msg.params ?? {}) as { chunk?: string; idle?: boolean };
    if (params.idle) {
      return {
        kind: "inbound",
        event: {
          kind: "notification",
          timestamp: Date.now(),
          payload: msg.params,
        },
      };
    }
    return {
      kind: "round",
      eventType: "chunk",
      payload: msg.params,
      text: params.chunk ?? "",
    };
  },
  closeRequest: (session) => ({ method: "finish", params: { session } }),
};

const driver = new LongLivedJsonRpcDriver({
  spawn: {
    command: process.execPath,
    args: ["--import", import.meta.resolve("tsx/esm"), FAKE_PEER],
    env: { ...process.env, FAKE_JSONRPC_PEER_BEHAVIOR: BEHAVIOR },
  },
  adapter,
  injectMode: "followUp",
  requestTimeoutMs: 5_000,
});

let closed = false;
let inboundKind: string | undefined;
let firstText = "";
let secondText = "";
await driver.start();
try {
  // 先注册 waitInbound 再触发交互：消除通知抢在注册前到达的时序窗口。
  const waitFirst = driver.waitInbound(
    (event) => event.kind === "notification",
    5_000,
  );
  const first = await driver.inject("first turn");
  firstText = first.text;
  const inbound = await waitFirst;
  inboundKind = inbound.kind;
  const second = await driver.inject("second turn");
  secondText = second.text;
} finally {
  await driver.close("long-lived-wire tutorial complete");
  await driver.close("idempotent second close");
  closed = true;
}

printTutorialSummary({
  recipe: "long-lived-wire",
  turns: 2,
  firstText,
  secondText,
  inboundKind,
  injectMode: driver.injectMode,
  closed,
});
