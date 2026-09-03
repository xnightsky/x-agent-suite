/**
 * @module @x-agent-suite/llm-fixture/wire-openai-responses
 * openai-responses wire handler（OpenAI Responses API 兼容宿主，/v1/responses，SSE）。
 * 不变量：
 * - 事件序列 response.created → response.output_item.done → response.completed；
 * - tool 轮 item 为 {"type":"function_call","call_id","namespace"（必填）,
 *   "name"（裸名）,"arguments"（JSON 字符串）,"status":"completed"}。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { FixtureTurn } from "@x-agent-suite/contracts";

/** openai-responses respond 选项。 */
export interface OpenAiResponsesWireOptions {
  /** 响应里回填的 model 字段；默认 "fake"。 */
  readonly model?: string;
}

/** 写一帧带 event 行的 SSE（event: <type>\ndata: <json>\n\n）。 */
function writeSseEvent(
  res: ServerResponse,
  event: string,
  data: unknown,
): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** 按 turn 构造 output item（function_call 或 message）。 */
function makeOutputItem(turn: FixtureTurn): Record<string, unknown> {
  if (turn.toolCall) {
    return {
      type: "function_call",
      call_id: "call_1",
      namespace: turn.toolCall.namespace,
      name: turn.toolCall.name,
      arguments: JSON.stringify(turn.toolCall.args),
      status: "completed",
    };
  }
  return {
    type: "message",
    id: "msg_fake",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: turn.text ?? "" }],
  };
}

/**
 * 按 openai-responses SSE 形态应答一轮。
 *
 * @behavior openai-responses-wire-respond
 * Given: turn 已被 fake-provider 校验（toolCall 与 text 恰居其一；tool 轮 namespace 必填）。
 * When: respond 被调用。
 * Then: 依次输出 response.created → response.output_item.done → response.completed 三帧。
 * Failure: 本函数不抛错；namespace 缺失由 fake-provider 以 400 先行拒绝。
 */
export function respond(
  options: OpenAiResponsesWireOptions,
  turn: FixtureTurn,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  void req;
  const model = options.model ?? "fake";
  const item = makeOutputItem(turn);
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
  });
  writeSseEvent(res, "response.created", {
    type: "response.created",
    response: {
      id: "resp_fake",
      object: "response",
      model,
      status: "in_progress",
      output: [],
    },
  });
  writeSseEvent(res, "response.output_item.done", {
    type: "response.output_item.done",
    output_index: 0,
    item,
  });
  writeSseEvent(res, "response.completed", {
    type: "response.completed",
    response: {
      id: "resp_fake",
      object: "response",
      model,
      status: "completed",
      output: [item],
    },
  });
  res.end();
}
