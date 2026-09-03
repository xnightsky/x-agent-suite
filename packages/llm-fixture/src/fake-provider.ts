/**
 * @module @x-agent-suite/llm-fixture/fake-provider
 * FakeProviderBackend：绑 127.0.0.1 端口 0 的 node:http 假 LLM 端点。
 * 不变量：
 * - 轮次判定不用全局计数器，按请求体中 tool result 的累计轮数取 script[轮次]
 *   （openai-chat: messages 含 role:"tool"；openai-responses: input 含
 *   function_call_output；anthropic-messages: body 含 tool_result；
 *   google-generate: body 含 functionResponse）；
 * - 请求体全量落盘（dumpPath 给定时 append JSONL，不截断）；
 * - 脚本耗尽、非法脚本轮、namespace 缺失等显式 400；未知路径 404。
 */
import { appendFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import type {
  FixtureProviderOptions,
  FixtureTurn,
  LlmBackend,
  WireProtocol,
} from "@x-agent-suite/contracts";
import { respond as respondAnthropicMessages } from "./wire-anthropic-messages.ts";
import { respond as respondGoogleGenerate } from "./wire-generate-content.ts";
import { respond as respondOpenAiChat } from "./wire-openai-chat.ts";
import { respond as respondOpenAiResponses } from "./wire-openai-responses.ts";

/** 判定请求体中 tool result 的累计轮数（即应取脚本第几轮）。 */
function countToolResults(
  wire: WireProtocol,
  body: Record<string, unknown>,
): number {
  switch (wire) {
    case "openai-chat": {
      const messages = Array.isArray(body.messages) ? body.messages : [];
      return messages.filter(
        (m) => (m as Record<string, unknown>).role === "tool",
      ).length;
    }
    case "openai-responses": {
      const input = Array.isArray(body.input) ? body.input : [];
      return input.filter(
        (item) =>
          (item as Record<string, unknown>).type === "function_call_output",
      ).length;
    }
    case "anthropic-messages": {
      const messages = Array.isArray(body.messages) ? body.messages : [];
      let count = 0;
      for (const message of messages) {
        const content = (message as Record<string, unknown>).content;
        if (Array.isArray(content)) {
          count += content.filter(
            (block) =>
              (block as Record<string, unknown>).type === "tool_result",
          ).length;
        }
      }
      return count;
    }
    // BOUNDARY-DEBT(harness): 协议标识保留历史名称，消费者 profile 可自定义
    case "gemini-generate": {
      const contents = Array.isArray(body.contents) ? body.contents : [];
      let count = 0;
      for (const content of contents) {
        const parts = (content as Record<string, unknown>).parts;
        if (Array.isArray(parts)) {
          count += parts.filter(
            (part) =>
              (part as Record<string, unknown>).functionResponse !== undefined,
          ).length;
        }
      }
      return count;
    }
    default:
      return 0;
  }
}

/** 判定请求路径是否命中本 wire 的已知端点（剥离 query string）。 */
function matchEndpoint(wire: WireProtocol, url: string): boolean {
  const pathname = new URL(url, "http://127.0.0.1").pathname;
  switch (wire) {
    case "openai-chat":
      return pathname.endsWith("/chat/completions");
    case "openai-responses":
      return pathname.endsWith("/responses");
    case "anthropic-messages":
      return pathname.endsWith("/messages");
    case "gemini-generate": // BOUNDARY-DEBT(harness): 协议标识保留历史名称
      return (
        pathname.includes(":generateContent") ||
        pathname.includes(":streamGenerateContent")
      );
    default:
      return false;
  }
}

/** 读取完整请求体文本。 */
async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** 以 JSON 错误体应答。 */
function respondError(
  res: ServerResponse,
  status: number,
  message: string,
): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { message } }));
}

/** 校验脚本轮合法（toolCall 与 text 恰居其一；openai-responses tool 轮 namespace 必填）。 */
function validateTurn(wire: WireProtocol, turn: FixtureTurn): string | null {
  if ((turn.toolCall === undefined) === (turn.text === undefined)) {
    return "脚本轮非法：toolCall 与 text 必须恰居其一";
  }
  if (
    wire === "openai-responses" &&
    turn.toolCall &&
    !turn.toolCall.namespace
  ) {
    return "openai-responses 的 tool 轮必须提供 namespace（否则 Responses API 报 unsupported call）";
  }
  return null;
}

/**
 * 自研假 LLM 端点：按 wire 分发到四个 wire handler，按请求体内容判定轮次。
 *
 * @behavior fake-provider-lifecycle
 * Given: 以 FixtureProviderOptions 构造并 start()。
 * When: 宿主向 baseUrl 的已知端点 POST。
 * Then: 按 wire 返回 SSE/JSON 响应；requests() 按序记录请求体；
 *       dumpPath 给定时全量落盘；stop() 幂等关闭。
 * Failure: JSON 解析失败 / 脚本耗尽 / 脚本轮非法 / namespace 缺失 → 400；未知路径 → 404。
 */
export class FakeProviderBackend implements LlmBackend {
  /** backend 模式，固定 fixture。 */
  readonly mode = "fixture" as const;

  private readonly options: FixtureProviderOptions;
  private readonly received: unknown[] = [];
  private server: Server | null = null;

  constructor(options: FixtureProviderOptions) {
    this.options = options;
  }

  /** 启动 server（127.0.0.1，端口 0），返回 baseUrl 与 dummy API key。 */
  start(): Promise<{ baseUrl: string; apiKey: string }> {
    if (this.server) {
      throw new Error("FakeProviderBackend 已启动，不允许重复 start()");
    }
    const server = createServer((req, res) => {
      void this.handle(req, res).catch((error: unknown) => {
        respondError(
          res,
          500,
          error instanceof Error ? error.message : String(error),
        );
      });
    });
    this.server = server;
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address() as AddressInfo;
        resolve({
          baseUrl: `http://127.0.0.1:${address.port}`,
          apiKey: "fake-api-key",
        });
      });
    });
  }

  /** 幂等关闭 server。 */
  stop(): Promise<void> {
    const server = this.server;
    if (!server) {
      return Promise.resolve();
    }
    this.server = null;
    return new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeIdleConnections();
    });
  }

  /** 已收到的请求体（按序），供断言与诊断。 */
  requests(): readonly unknown[] {
    return [...this.received];
  }

  /** 处理单个请求：读体 → 解析 → 记录/落盘 → 判定轮次 → 分发 wire handler。 */
  private async handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const url = req.url ?? "/";
    if (req.method !== "POST" || !matchEndpoint(this.options.wire, url)) {
      respondError(res, 404, `未知路径：${req.method ?? "?"} ${url}`);
      return;
    }
    const raw = await readBody(req);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      respondError(res, 400, "请求体不是合法 JSON");
      return;
    }
    this.received.push(body);
    if (this.options.dumpPath) {
      await appendFile(
        this.options.dumpPath,
        `${JSON.stringify(body)}\n`,
        "utf8",
      );
    }

    const turnIndex = countToolResults(this.options.wire, body);
    const turn = this.options.script[turnIndex];
    if (!turn) {
      respondError(
        res,
        400,
        `脚本已耗尽：请求体含 ${turnIndex} 轮 tool result，但脚本只有 ${this.options.script.length} 轮`,
      );
      return;
    }
    const invalid = validateTurn(this.options.wire, turn);
    if (invalid) {
      respondError(res, 400, invalid);
      return;
    }
    this.dispatch(url, turn, req, res);
  }

  /** 按 wire 分发到对应 handler。 */
  private dispatch(
    url: string,
    turn: FixtureTurn,
    req: IncomingMessage,
    res: ServerResponse,
  ): void {
    switch (this.options.wire) {
      case "openai-chat":
        respondOpenAiChat({}, turn, req, res);
        return;
      case "openai-responses":
        respondOpenAiResponses({}, turn, req, res);
        return;
      case "anthropic-messages":
        respondAnthropicMessages({}, turn, req, res);
        return;
      case "gemini-generate": // BOUNDARY-DEBT(harness): 协议标识保留历史名称
        respondGoogleGenerate(
          { stream: url.includes(":streamGenerateContent") },
          turn,
          req,
          res,
        );
        return;
    }
  }
}
