/**
 * @module @x-agent-suite/llm-fixture/wire-generate-content
 * google-generate wire handler（Google generateContent / streamGenerateContent API）。
 * 不变量：
 * - candidates[0].content.parts[0] 为 {functionCall:{name,args}} 或 {text}；
 * - 流式时包一层 data: <json>\n\n，非流式直接返回 JSON。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { FixtureTurn } from "@x-agent-suite/contracts";

/** google-generate respond 选项。 */
export interface GeminiGenerateWireOptions {
  /** 是否流式（:streamGenerateContent）应答；false 为一次性 JSON。 */
  readonly stream: boolean;
  /** 响应里回填的 modelVersion 字段；默认 "fake"。 */
  readonly model?: string;
}

/** 按 turn 构造 google 响应体（functionCall 或 text part）。 */
function makeBody(turn: FixtureTurn, model: string): Record<string, unknown> {
  const part = turn.toolCall
    ? { functionCall: { name: turn.toolCall.name, args: turn.toolCall.args } }
    : { text: turn.text ?? "" };
  return {
    candidates: [
      {
        content: { role: "model", parts: [part] },
        finishReason: "STOP",
        index: 0,
      },
    ],
    modelVersion: model,
  };
}

/**
 * 按 google-generate 形态应答一轮。
 *
 * @behavior google-generate-wire-respond
 * Given: turn 已被 fake-provider 校验（toolCall 与 text 恰居其一）。
 * When: respond 被调用，stream 由请求路径（:streamGenerateContent）决定。
 * Then: 非流式返回 application/json 单体响应；流式返回一帧 data: <json> SSE。
 * Failure: 本函数不抛错；turn 校验失败由 fake-provider 以 400 先行拒绝。
 */
export function respond(
  options: GeminiGenerateWireOptions,
  turn: FixtureTurn,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  void req;
  const body = makeBody(turn, options.model ?? "fake");
  if (options.stream) {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    });
    res.write(`data: ${JSON.stringify(body)}\n\n`);
  } else {
    res.writeHead(200, { "content-type": "application/json" });
    res.write(JSON.stringify(body));
  }
  res.end();
}
