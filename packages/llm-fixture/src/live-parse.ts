/**
 * @module @x-agent-suite/llm-fixture/live-parse
 * live 链路的响应解析：把四种 wire 的（SSE 或一次性 JSON）响应归一为 LiveCompletion。
 * 不变量：
 * - HTTP >= 400 抛 LiveHttpError（含状态码与原文截断，脱敏由调用方负责）；
 * - 响应体非法（JSON 解析失败、形态缺失）抛显式 Error，不静默返回空结果；
 * - SSE 与 JSON 双形态兼容（自研假端点恒 SSE，真实 provider 非流式恒 JSON）。
 */
import type { WireProtocol } from "@x-agent-suite/contracts";
import type { LiveCompletion, LiveCompletionToolCall } from "./live-wires.ts";

/** HTTP 层错误（状态码 + 原文截断）。 */
export class LiveHttpError extends Error {
  /** HTTP 状态码。 */
  readonly status: number;
  /** 响应原文截断（前 300 字符）。 */
  readonly bodySnippet: string;

  constructor(status: number, body: string) {
    super(`HTTP ${status}：${body.slice(0, 300)}`);
    this.name = "LiveHttpError";
    this.status = status;
    this.bodySnippet = body.slice(0, 300);
  }
}

/** 把 SSE 原文拆成 data 载荷序列（忽略 event: 行与 [DONE]）。 */
function sseDataFrames(text: string): string[] {
  const frames: string[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trim());
      }
    }
    const data = dataLines.join("\n");
    if (data && data !== "[DONE]") {
      frames.push(data);
    }
  }
  return frames;
}

/** 解析为 JSON 对象序列：SSE（含 event: 行的形态）取各 data 帧，否则整体解析一次。 */
function payloadObjects(
  wire: WireProtocol,
  text: string,
): Record<string, unknown>[] {
  const trimmed = text.trim();
  const isSse = trimmed.split(/\r?\n/).some((line) => line.startsWith("data:"));
  const raws = isSse ? sseDataFrames(trimmed) : [trimmed];
  return raws.map((raw, index) => {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch (error) {
      throw new Error(
        `响应解析失败（${wire}，第 ${index + 1} 帧）：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}

/** 安全取嵌套字段。 */
function dig(value: unknown, ...keys: (string | number)[]): unknown {
  let current: unknown = value;
  for (const key of keys) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}

/** openai-chat：chunk/message 归一。 */
function parseOpenAiChat(objects: Record<string, unknown>[]): LiveCompletion {
  let text = "";
  const toolCalls = new Map<
    number,
    { id?: string; name: string; argsText: string }
  >();
  let usage: LiveCompletion["usage"];
  let model: string | undefined;
  for (const obj of objects) {
    model = (obj.model as string | undefined) ?? model;
    const rawUsage = obj.usage as Record<string, unknown> | undefined;
    if (rawUsage) {
      usage = {
        promptTokens: Number(rawUsage.prompt_tokens ?? 0),
        completionTokens: Number(rawUsage.completion_tokens ?? 0),
        totalTokens: Number(rawUsage.total_tokens ?? 0),
      };
    }
    const choice = dig(obj, "choices", 0) as
      Record<string, unknown> | undefined;
    const message = (choice?.delta ?? choice?.message) as
      Record<string, unknown> | undefined;
    if (typeof message?.content === "string") {
      text += message.content;
    }
    const calls =
      (message?.tool_calls as Record<string, unknown>[] | undefined) ?? [];
    for (const [position, call] of calls.entries()) {
      const index = Number(call.index ?? position);
      const entry = toolCalls.get(index) ?? { name: "", argsText: "" };
      if (typeof call.id === "string") entry.id = call.id;
      const fn = call.function as Record<string, unknown> | undefined;
      if (typeof fn?.name === "string") entry.name = fn.name;
      if (typeof fn?.arguments === "string") entry.argsText += fn.arguments;
      toolCalls.set(index, entry);
    }
  }
  return {
    text,
    toolCalls: [...toolCalls.values()].map((c) => ({
      ...(c.id ? { id: c.id } : {}),
      name: c.name,
      args: parseArgs(c.argsText),
    })),
    ...(usage ? { usage } : {}),
    ...(model ? { model } : {}),
  };
}

/** anthropic-messages：SSE 事件序列或一次性 JSON 归一。 */
function parseAnthropic(objects: Record<string, unknown>[]): LiveCompletion {
  let text = "";
  const toolCalls: (LiveCompletionToolCall & { argsText: string })[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let model: string | undefined;
  let sawUsage = false;
  for (const obj of objects) {
    const type = obj.type as string | undefined;
    if (type === "message_start") {
      model = (dig(obj, "message", "model") as string | undefined) ?? model;
      const input = dig(obj, "message", "usage", "input_tokens");
      if (typeof input === "number") {
        inputTokens += input;
        sawUsage = true;
      }
    } else if (type === "content_block_start") {
      const block = obj.content_block as Record<string, unknown> | undefined;
      if (block?.type === "tool_use") {
        toolCalls.push({
          id: block.id as string | undefined,
          name: String(block.name ?? ""),
          args: undefined,
          argsText: "",
        });
      }
    } else if (type === "content_block_delta") {
      const delta = obj.delta as Record<string, unknown> | undefined;
      if (delta?.type === "text_delta") {
        text += String(delta.text ?? "");
      } else if (delta?.type === "input_json_delta" && toolCalls.length > 0) {
        toolCalls[toolCalls.length - 1]!.argsText += String(
          delta.partial_json ?? "",
        );
      }
    } else if (type === "message_delta") {
      const output = dig(obj, "usage", "output_tokens");
      if (typeof output === "number") {
        outputTokens += output;
        sawUsage = true;
      }
    } else if (type === "message" || !type) {
      // 一次性 JSON：content 块数组 + usage + model。
      model = (obj.model as string | undefined) ?? model;
      for (const block of (obj.content as
        Record<string, unknown>[] | undefined) ?? []) {
        if (block.type === "text") text += String(block.text ?? "");
        if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id as string | undefined,
            name: String(block.name ?? ""),
            args: block.input,
            argsText: "",
          });
        }
      }
      const usage = obj.usage as Record<string, unknown> | undefined;
      if (usage) {
        inputTokens += Number(usage.input_tokens ?? 0);
        outputTokens += Number(usage.output_tokens ?? 0);
        sawUsage = true;
      }
    }
  }
  return {
    text,
    toolCalls: toolCalls.map((c) => ({
      ...(c.id ? { id: c.id } : {}),
      name: c.name,
      args: c.argsText ? parseArgs(c.argsText) : (c.args ?? {}),
    })),
    ...(sawUsage
      ? {
          usage: {
            promptTokens: inputTokens,
            completionTokens: outputTokens,
            totalTokens: inputTokens + outputTokens,
          },
        }
      : {}),
    ...(model ? { model } : {}),
  };
}

/** openai-responses：output item 归一（SSE 的 output_item.done / completed，或一次性 JSON）。 */
function parseOpenAiResponses(
  objects: Record<string, unknown>[],
): LiveCompletion {
  let text = "";
  const toolCalls: LiveCompletionToolCall[] = [];
  let usage: LiveCompletion["usage"];
  let model: string | undefined;
  const handleItem = (item: Record<string, unknown>): void => {
    if (item.type === "function_call") {
      toolCalls.push({
        id: item.call_id as string | undefined,
        name: String(item.name ?? ""),
        args: parseArgs(String(item.arguments ?? "")),
      });
    } else if (item.type === "message") {
      for (const part of (item.content as
        Record<string, unknown>[] | undefined) ?? []) {
        if (part.type === "output_text") {
          text += String(part.text ?? "");
        }
      }
    }
  };
  for (const obj of objects) {
    // SSE 事件的响应体在 obj.response；一次性 JSON 的响应体即 obj 本身。
    const response = (obj.type ? obj.response : obj) as
      Record<string, unknown> | undefined;
    model = (response?.model as string | undefined) ?? model;
    if (obj.type === "response.output_item.done" && obj.item) {
      handleItem(obj.item as Record<string, unknown>);
    }
    const rawUsage = response?.usage as Record<string, unknown> | undefined;
    if (rawUsage) {
      const prompt = Number(rawUsage.input_tokens ?? 0);
      const completion = Number(rawUsage.output_tokens ?? 0);
      usage = {
        promptTokens: prompt,
        completionTokens: completion,
        totalTokens: Number(rawUsage.total_tokens ?? prompt + completion),
      };
    }
    for (const item of (response?.output as
      Record<string, unknown>[] | undefined) ?? []) {
      // SSE 的 completed 事件会重复携带 output（item 已经由 output_item.done 处理过），
      // 只有一次性 JSON（无 type）才从 output 提取。
      if (!obj.type) {
        handleItem(item);
      }
    }
  }
  return {
    text,
    toolCalls,
    ...(usage ? { usage } : {}),
    ...(model ? { model } : {}),
  };
}

/** google-generate：candidates parts 归一（每帧一个候选体）。 */
function parseGemini(objects: Record<string, unknown>[]): LiveCompletion {
  let text = "";
  const toolCalls: LiveCompletionToolCall[] = [];
  let usage: LiveCompletion["usage"];
  let model: string | undefined;
  for (const obj of objects) {
    model = (obj.modelVersion as string | undefined) ?? model;
    for (const part of (dig(obj, "candidates", 0, "content", "parts") as
      Record<string, unknown>[] | undefined) ?? []) {
      if (typeof part.text === "string") {
        text += part.text;
      }
      const call = part.functionCall as Record<string, unknown> | undefined;
      if (call) {
        toolCalls.push({
          name: String(call.name ?? ""),
          args: call.args ?? {},
        });
      }
    }
    const meta = obj.usageMetadata as Record<string, unknown> | undefined;
    if (meta) {
      usage = {
        promptTokens: Number(meta.promptTokenCount ?? 0),
        completionTokens: Number(meta.candidatesTokenCount ?? 0),
        totalTokens: Number(meta.totalTokenCount ?? 0),
      };
    }
  }
  return {
    text,
    toolCalls,
    ...(usage ? { usage } : {}),
    ...(model ? { model } : {}),
  };
}

/** 解析工具入参 JSON 字符串；空串按 {} 处理，非法 JSON 显式抛错。 */
function parseArgs(argsText: string): unknown {
  if (argsText === "") {
    return {};
  }
  try {
    return JSON.parse(argsText);
  } catch (error) {
    throw new Error(
      `工具入参 JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * 归一解析一次补全响应。
 * @param wire 协议类型。
 * @param status HTTP 状态码；>= 400 抛 LiveHttpError。
 * @param text 响应原文（SSE 或 JSON）。
 */
export function parseLiveResponse(
  wire: WireProtocol,
  status: number,
  text: string,
): LiveCompletion {
  if (status >= 400) {
    throw new LiveHttpError(status, text);
  }
  const objects = payloadObjects(wire, text);
  switch (wire) {
    case "openai-chat":
      return parseOpenAiChat(objects);
    case "anthropic-messages":
      return parseAnthropic(objects);
    case "openai-responses":
      return parseOpenAiResponses(objects);
    case "gemini-generate": // BOUNDARY-DEBT(harness): 协议标识保留历史名称
      return parseGemini(objects);
    default:
      throw new Error(`不支持的 wire 协议：${wire}`);
  }
}
