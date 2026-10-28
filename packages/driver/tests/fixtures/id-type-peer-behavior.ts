/**
 * @module @x-agent-suite/driver/tests/fixtures/id-type-peer-behavior
 * jsonrpc-peer-id-type.test.ts 的演示行为：虚构通用方法名，验证响应 id
 * 严格按类型与值配对。行为脚本：
 * - "string-id-decoy"：先回若干字符串 id 应答（其 Number() 归一值等于请求 id），
 *   再回一条未知数值 id 应答，最后回正确的数值 id 应答；
 * - "string-id-error-decoy"：先回一条字符串 id 的错误应答，再回正确数值 id 应答。
 * 本文件不内置任何协议语义，仅覆盖 wire 层 id 配对边界。
 */
import type { FakePeerApi } from "./fake-jsonrpc-peer.ts";

/** 写一条原始 JSON-RPC 应答到 stdout。 */
function sendAnswer(api: FakePeerApi, id: unknown, payload: unknown): void {
  api.sendRaw(JSON.stringify({ jsonrpc: "2.0", id, ...(payload as object) }));
}

/** 注册 id 类型边界行为。 */
export default function setup(api: FakePeerApi): void {
  api.onRequest("echo", (params) => params);
  api.onRequest("string-id-decoy", (_params, context) => {
    const id = context.id;
    if (id === undefined) {
      throw new Error("string-id-decoy 需要请求 id");
    }
    for (const decoyId of [String(id), `0${id}`, `${id}e0`]) {
      sendAnswer(api, decoyId, { result: `WRONG_STRING_ID_${decoyId}` });
    }
    sendAnswer(api, 987_654_321, { result: "WRONG_UNKNOWN_NUMERIC_ID" });
    return "CORRECT_NUMERIC_ID";
  });
  api.onRequest("string-id-error-decoy", (_params, context) => {
    const id = context.id;
    if (id === undefined) {
      throw new Error("string-id-error-decoy 需要请求 id");
    }
    sendAnswer(api, String(id), {
      error: { code: -32000, message: "WRONG_STRING_ID_ERROR" },
    });
    return "CORRECT_NUMERIC_ID";
  });
}
