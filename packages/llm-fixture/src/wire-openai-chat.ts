/**
 * @module @x-agent-suite/llm-fixture/wire-openai-chat
 * openai-chat wire handler（OpenAI 兼容 chat completions 宿主，/v1/chat/completions，SSE）。
 * 不变量：
 * - 一律以 chat.completion.chunk SSE 输出并以 data: [DONE] 收尾；
 * - tool 轮 delta.tool_calls（带 index、id、function.name/arguments JSON 字符串）
 *   且 finish_reason 为 "tool_calls"；文本轮 delta.content 且 finish_reason 为 "stop"。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { FixtureTurn } from "@x-agent-suite/contracts";

/** openai-chat respond 选项。 */
export interface OpenAiChatWireOptions {
  /** 响应里回填的 model 字段；默认 "fake"。 */
  readonly model?: string;
}

/** 写一帧 SSE（data: <json>\n\n）。 */
function writeSseData(res: ServerResponse, data: unknown): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/** 生成一个 chat.completion.chunk。 */
function makeChunk(
  model: string,
  delta: Record<string, unknown>,
  finishReason: string | null,
): Record<string, unknown> {
  return {
    id: "chatcmpl-fake",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

/**
 * 按 openai-chat SSE 形态应答一轮。
 *
 * @behavior openai-chat-wire-respond
 * Given: turn 已被 fake-provider 校验（toolCall 与 text 恰居其一）。
 * When: respond 被调用。
 * Then: tool 轮输出 role chunk → tool_calls chunk → finish "tool_calls" chunk → [DONE]；
 *       文本轮输出 role chunk → content chunk → finish "stop" chunk → [DONE]。
 * Failure: 本函数不抛错；turn 校验失败由 fake-provider 以 400 先行拒绝。
 */
export function respond(
  options: OpenAiChatWireOptions,
  turn: FixtureTurn,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  void req;
  const model = options.model ?? "fake";
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
  });
  writeSseData(res, makeChunk(model, { role: "assistant" }, null));
  if (turn.toolCall) {
    writeSseData(
      res,
      makeChunk(
        model,
        {
          tool_calls: [
            {
              index: 0,
              id: "call_1",
              type: "function",
              function: {
                name: turn.toolCall.name,
                arguments: JSON.stringify(turn.toolCall.args),
              },
            },
          ],
        },
        null,
      ),
    );
    writeSseData(res, makeChunk(model, {}, "tool_calls"));
  } else {
    writeSseData(res, makeChunk(model, { content: turn.text ?? "" }, null));
    writeSseData(res, makeChunk(model, {}, "stop"));
  }
  res.write("data: [DONE]\n\n");
  res.end();
}
