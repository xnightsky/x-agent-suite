/**
 * @module @x-agent-suite/llm-fixture/wire-anthropic-messages
 * anthropic-messages wire handler（Anthropic Messages API 兼容宿主，/v1/messages，SSE）。
 * 不变量：
 * - 事件序列 message_start → content_block_start → content_block_delta →
 *   content_block_stop → message_delta → message_stop；
 * - tool 轮 content_block 为 {type:"tool_use",name}，入参走 input_json_delta 的
 *   partial_json，message_delta.delta.stop_reason 为 "tool_use"；文本轮为 "end_turn"。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { FixtureTurn } from "@x-agent-suite/contracts";

/** anthropic-messages respond 选项。 */
export interface AnthropicMessagesWireOptions {
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

/**
 * 按 anthropic-messages SSE 形态应答一轮。
 *
 * @behavior anthropic-messages-wire-respond
 * Given: turn 已被 fake-provider 校验（toolCall 与 text 恰居其一）。
 * When: respond 被调用。
 * Then: 输出 message_start → content_block_start → content_block_delta →
 *       content_block_stop → message_delta → message_stop 六帧；
 *       stop_reason 按轮型取 "tool_use" / "end_turn"。
 * Failure: 本函数不抛错；turn 校验失败由 fake-provider 以 400 先行拒绝。
 */
export function respond(
  options: AnthropicMessagesWireOptions,
  turn: FixtureTurn,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  void req;
  const model = options.model ?? "fake";
  const isTool = turn.toolCall !== undefined;
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
  });
  writeSseEvent(res, "message_start", {
    type: "message_start",
    message: {
      id: "msg_fake",
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  });
  writeSseEvent(res, "content_block_start", {
    type: "content_block_start",
    index: 0,
    content_block: isTool
      ? {
          type: "tool_use",
          id: "toolu_fake",
          name: turn.toolCall?.name,
          input: {},
        }
      : { type: "text", text: "" },
  });
  writeSseEvent(res, "content_block_delta", {
    type: "content_block_delta",
    index: 0,
    delta: isTool
      ? {
          type: "input_json_delta",
          partial_json: JSON.stringify(turn.toolCall?.args),
        }
      : { type: "text_delta", text: turn.text ?? "" },
  });
  writeSseEvent(res, "content_block_stop", {
    type: "content_block_stop",
    index: 0,
  });
  writeSseEvent(res, "message_delta", {
    type: "message_delta",
    delta: { stop_reason: isTool ? "tool_use" : "end_turn" },
    usage: { output_tokens: 1 },
  });
  writeSseEvent(res, "message_stop", { type: "message_stop" });
  res.end();
}
