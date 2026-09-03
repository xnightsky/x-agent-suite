/**
 * @module @x-agent-suite/llm-fixture/live-wires
 * live 链路的 wire 请求构造与 transport 抽象（sniff 门禁与 LiveBackend 共用）。
 * 不变量：
 * - baseUrl 含版本前缀（如 "https://host/v1"），builder 只拼接端点尾段；
 * - 默认 transport 基于全局 fetch，可注入替身以便单元测试（零 token）；
 * - 本模块不解析响应体（解析见 live-parse），不做任何脱敏（脱敏见 live-config）。
 */
import type { WireProtocol } from "@x-agent-suite/contracts";

/** assistant 消息里的一次工具调用（回喂历史用）。 */
export interface LiveToolCallReq {
  /** 调用 id（openai-chat 的 tool_call_id / anthropic 的 tool_use_id）。 */
  readonly id: string;
  /** 工具名（wire 形态）。 */
  readonly name: string;
  /** 工具入参。 */
  readonly args: unknown;
}

/** 归一消息模型：user 文本 / assistant 文本+工具调用 / tool 结果回喂。 */
export type LiveMessage =
  | { readonly role: "user"; readonly text: string }
  | {
      readonly role: "assistant";
      readonly text: string;
      readonly toolCalls?: readonly LiveToolCallReq[];
    }
  | {
      readonly role: "tool";
      readonly toolCallId: string;
      readonly name: string;
      readonly text: string;
    };

/** 工具声明（归一形态，各 wire builder 自行翻译）。 */
export interface LiveToolSpec {
  /** 工具名。 */
  readonly name: string;
  /** 工具描述。 */
  readonly description: string;
  /** JSON Schema 参数声明。 */
  readonly parameters: Record<string, unknown>;
}

/** 一次出站请求（POST JSON）。 */
export interface LiveRequest {
  readonly method: "POST";
  /** 完整 URL（含版本前缀与端点尾段）。 */
  readonly url: string;
  /** 请求头（含鉴权头）。 */
  readonly headers: Record<string, string>;
  /** 请求体（JSON 序列化前）。 */
  readonly body: unknown;
}

/** 一次响应（状态码 + 原文；SSE 与 JSON 均按原文返回，解析在 live-parse）。 */
export interface LiveResponse {
  readonly status: number;
  readonly text: string;
}

/** 可注入 transport：便于测试用 FakeProviderBackend 或桩替代真实网络。 */
export type LiveTransport = (req: LiveRequest) => Promise<LiveResponse>;

/** 默认 transport：全局 fetch。 */
export function createFetchTransport(): LiveTransport {
  return async (req) => {
    const response = await fetch(req.url, {
      method: req.method,
      headers: { "content-type": "application/json", ...req.headers },
      body: JSON.stringify(req.body),
    });
    return { status: response.status, text: await response.text() };
  };
}

/** token 用量（归一形态）。 */
export interface LiveUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

/** 归一后的响应里一次工具调用。 */
export interface LiveCompletionToolCall {
  /** 调用 id（部分 wire 缺省）。 */
  readonly id?: string;
  /** 工具名。 */
  readonly name: string;
  /** 解析后的工具入参。 */
  readonly args: unknown;
}

/** 归一后的补全结果。 */
export interface LiveCompletion {
  /** 文本内容（拼接）。 */
  readonly text: string;
  /** 工具调用列表。 */
  readonly toolCalls: LiveCompletionToolCall[];
  /** token 用量（响应携带时；供 costUsd 估算）。 */
  readonly usage?: LiveUsage;
  /** 响应回填的模型标识（尽力回报，供矩阵报告归因）。 */
  readonly model?: string;
}

/** buildLiveRequest 的输入。 */
export interface LiveRequestInput {
  /** API base URL（含版本前缀，如 "https://host/v1"）。 */
  readonly baseUrl: string;
  /** 模型标识。 */
  readonly model: string;
  /** API key（缺省不带鉴权头，适配本地免鉴权渠道）。 */
  readonly apiKey?: string;
  /** 归一消息序列。 */
  readonly messages: readonly LiveMessage[];
  /** 工具声明（可选）。 */
  readonly tools?: readonly LiveToolSpec[];
  /** 最大输出 token（anthropic 必填，其余可选）。 */
  readonly maxTokens?: number;
}

/** 鉴权头（按 wire 分派；apiKey 缺省时不带）。 */
function authHeaders(
  wire: WireProtocol,
  apiKey?: string,
): Record<string, string> {
  if (!apiKey) {
    return wire === "anthropic-messages"
      ? { "anthropic-version": "2023-06-01" }
      : {};
  }
  switch (wire) {
    case "openai-chat":
    case "openai-responses":
      return { authorization: `Bearer ${apiKey}` };
    case "anthropic-messages":
      return { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
    case "gemini-generate": // BOUNDARY-DEBT(harness): 协议标识保留历史名称
      return { "x-goog-api-key": apiKey };
    default:
      throw new Error(`不支持的 wire 协议：${wire}`);
  }
}

/** openai-chat 请求体（/chat/completions）。 */
function buildOpenAiChatBody(input: LiveRequestInput): Record<string, unknown> {
  const messages = input.messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "tool",
        tool_call_id: message.toolCallId,
        content: message.text,
      };
    }
    if (message.role === "assistant") {
      return {
        role: "assistant",
        content: message.text,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: "function",
                function: {
                  name: call.name,
                  arguments: JSON.stringify(call.args),
                },
              })),
            }
          : {}),
      };
    }
    return { role: "user", content: message.text };
  });
  return {
    model: input.model,
    messages,
    ...(input.tools?.length
      ? { tools: input.tools.map((t) => ({ type: "function", function: t })) }
      : {}),
    ...(input.maxTokens ? { max_tokens: input.maxTokens } : {}),
  };
}

/** openai-responses 请求体（/responses）。 */
function buildOpenAiResponsesBody(
  input: LiveRequestInput,
): Record<string, unknown> {
  const items: unknown[] = [];
  for (const message of input.messages) {
    if (message.role === "user") {
      items.push({ role: "user", content: message.text });
    } else if (message.role === "assistant") {
      if (message.text) {
        items.push({
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: message.text }],
        });
      }
      for (const call of message.toolCalls ?? []) {
        items.push({
          type: "function_call",
          call_id: call.id,
          name: call.name,
          arguments: JSON.stringify(call.args),
        });
      }
    } else {
      items.push({
        type: "function_call_output",
        call_id: message.toolCallId,
        output: message.text,
      });
    }
  }
  return {
    model: input.model,
    input: items,
    ...(input.tools?.length
      ? {
          tools: input.tools.map((t) => ({
            type: "function",
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        }
      : {}),
    ...(input.maxTokens ? { max_output_tokens: input.maxTokens } : {}),
  };
}

/** anthropic-messages 请求体（/messages）。 */
function buildAnthropicBody(input: LiveRequestInput): Record<string, unknown> {
  const messages: unknown[] = [];
  for (const message of input.messages) {
    if (message.role === "user") {
      messages.push({ role: "user", content: message.text });
    } else if (message.role === "assistant") {
      const blocks: unknown[] = [];
      if (message.text) {
        blocks.push({ type: "text", text: message.text });
      }
      for (const call of message.toolCalls ?? []) {
        blocks.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: call.args,
        });
      }
      messages.push({ role: "assistant", content: blocks });
    } else {
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: message.toolCallId,
            content: message.text,
          },
        ],
      });
    }
  }
  return {
    model: input.model,
    max_tokens: input.maxTokens ?? 1024,
    messages,
    ...(input.tools?.length
      ? {
          tools: input.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters,
          })),
        }
      : {}),
  };
}

/** google-generate 请求体（:generateContent，非流式）。 */
function buildGeminiBody(input: LiveRequestInput): Record<string, unknown> {
  const contents: unknown[] = [];
  for (const message of input.messages) {
    if (message.role === "user") {
      contents.push({ role: "user", parts: [{ text: message.text }] });
    } else if (message.role === "assistant") {
      const parts: unknown[] = [];
      if (message.text) {
        parts.push({ text: message.text });
      }
      for (const call of message.toolCalls ?? []) {
        parts.push({ functionCall: { name: call.name, args: call.args } });
      }
      contents.push({ role: "model", parts });
    } else {
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: message.name,
              response: { result: message.text },
            },
          },
        ],
      });
    }
  }
  return {
    contents,
    ...(input.tools?.length
      ? { tools: [{ functionDeclarations: input.tools }] }
      : {}),
    ...(input.maxTokens
      ? { generationConfig: { maxOutputTokens: input.maxTokens } }
      : {}),
  };
}

/** 各 wire 的端点尾段（baseUrl 已含版本前缀）。 */
function endpointPath(wire: WireProtocol, model: string): string {
  switch (wire) {
    case "openai-chat":
      return "/chat/completions";
    case "openai-responses":
      return "/responses";
    case "anthropic-messages":
      return "/messages";
    case "gemini-generate": // BOUNDARY-DEBT(harness): 协议标识保留历史名称
      return `/models/${encodeURIComponent(model)}:generateContent`;
    default:
      throw new Error(`不支持的 wire 协议：${wire}`);
  }
}

/** 按 wire 构造一次补全请求（非流式；对端为 SSE-only 假端点时由 live-parse 兼容解析）。 */
export function buildLiveRequest(
  wire: WireProtocol,
  input: LiveRequestInput,
): LiveRequest {
  const body =
    wire === "openai-chat"
      ? buildOpenAiChatBody(input)
      : wire === "openai-responses"
        ? buildOpenAiResponsesBody(input)
        : wire === "anthropic-messages"
          ? buildAnthropicBody(input)
          : buildGeminiBody(input);
  return {
    method: "POST",
    url: `${input.baseUrl.replace(/\/+$/, "")}${endpointPath(wire, input.model)}`,
    headers: authHeaders(wire, input.apiKey),
    body,
  };
}
