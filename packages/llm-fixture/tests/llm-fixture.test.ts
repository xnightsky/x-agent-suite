/**
 * @module @x-agent-suite/llm-fixture/tests/llm-fixture
 * FakeProviderBackend 四种 wire 的响应形态、轮次判定、requests() 记录、
 * dumpPath 落盘与 createLlmBackend 工厂测试。
 * 不变量：只用 node: 内置与 fetch 模拟宿主请求，不起任何真实 CLI；
 * 轮次断言基于「请求体中 tool result 的累计轮数」，不依赖全局计数器。
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createLlmBackend,
  FakeProviderBackend,
} from "@x-agent-suite/llm-fixture";
import type { FixtureTurn } from "@x-agent-suite/contracts";

/** 以 JSON POST 模拟宿主请求，返回状态码与响应原文。 */
async function postJson(
  url: string,
  body: unknown,
): Promise<{ status: number; text: string }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, text: await response.text() };
}

/** 一条解析后的 SSE 帧。 */
interface SseFrame {
  /** event: 行内容；缺省为 null。 */
  readonly event: string | null;
  /** data: 行拼接内容。 */
  readonly data: string;
}

/** 把 SSE 原文拆成帧序列（按空行分帧）。 */
function parseSseFrames(text: string): SseFrame[] {
  return text
    .split("\n\n")
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => {
      let event: string | null = null;
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) {
          event = line.slice("event:".length).trim();
        } else if (line.startsWith("data:")) {
          data += line.slice("data:".length).trim();
        }
      }
      return { event, data };
    });
}

/** 起一台 fixture backend，测试结束统一 stop。 */
async function startBackend(
  wire: string,
  script: readonly FixtureTurn[],
  dumpPath?: string,
) {
  const backend = new FakeProviderBackend({ wire, script, dumpPath });
  const { baseUrl, apiKey } = await backend.start();
  return { backend, baseUrl, apiKey };
}

test("openai-chat：首轮返回 tool_calls chunk，次轮（含 role:tool）返回文本轮", async () => {
  const { backend, baseUrl, apiKey } = await startBackend("openai-chat", [
    {
      toolCall: {
        name: "mcp__any_intercom__intercom",
        args: { handle: "A", action: "list" },
      },
    },
    { text: "DONE" },
  ]);
  try {
    assert.equal(backend.mode, "fixture");
    assert.ok(apiKey.length > 0, "apiKey 不应为空");

    const first = await postJson(`${baseUrl}/v1/chat/completions`, {
      model: "fake",
      messages: [{ role: "user", content: "列出在线会话" }],
    });
    assert.equal(first.status, 200, first.text);
    const firstFrames = parseSseFrames(first.text);
    const firstChunks = firstFrames
      .filter((frame) => frame.data !== "[DONE]")
      .map((frame) => JSON.parse(frame.data) as Record<string, unknown>);
    assert.ok(firstChunks.length >= 2, "至少应有内容 chunk 与 finish chunk");
    for (const chunk of firstChunks) {
      assert.equal(chunk.object, "chat.completion.chunk");
    }
    const toolCallChunk = firstChunks.find((chunk) => {
      const delta = (
        chunk.choices as Array<{ delta: Record<string, unknown> }>
      )[0]?.delta;
      return delta?.tool_calls !== undefined;
    });
    assert.ok(toolCallChunk, "缺少 delta.tool_calls chunk");
    const toolCalls = (
      toolCallChunk.choices as Array<{ delta: { tool_calls: unknown[] } }>
    )[0]!.delta.tool_calls as Array<{
      index: number;
      id: string;
      function: { name: string; arguments: string };
    }>;
    assert.equal(toolCalls[0]?.index, 0);
    assert.ok(toolCalls[0]?.id, "tool_call 必须有 id");
    assert.equal(toolCalls[0]?.function.name, "mcp__any_intercom__intercom");
    assert.deepEqual(JSON.parse(toolCalls[0]!.function.arguments), {
      handle: "A",
      action: "list",
    });
    const finishChunk = firstChunks.at(-1) as {
      choices: Array<{ finish_reason: string }>;
    };
    assert.equal(finishChunk.choices[0]?.finish_reason, "tool_calls");
    assert.equal(
      firstFrames.at(-1)?.data,
      "[DONE]",
      "SSE 必须以 data: [DONE] 收尾",
    );

    const second = await postJson(`${baseUrl}/v1/chat/completions`, {
      model: "fake",
      messages: [
        { role: "user", content: "列出在线会话" },
        { role: "assistant", tool_calls: toolCalls },
        { role: "tool", tool_call_id: toolCalls[0]?.id, content: "[]" },
      ],
    });
    assert.equal(second.status, 200, second.text);
    const secondChunks = parseSseFrames(second.text)
      .filter((frame) => frame.data !== "[DONE]")
      .map((frame) => JSON.parse(frame.data) as Record<string, unknown>);
    const textChunk = secondChunks.find((chunk) => {
      const delta = (
        chunk.choices as Array<{ delta: Record<string, unknown> }>
      )[0]?.delta;
      return typeof delta?.content === "string" && delta.content.length > 0;
    });
    assert.equal(
      (textChunk?.choices as Array<{ delta: { content: string } }>)[0]?.delta
        .content,
      "DONE",
    );
    assert.equal(
      (secondChunks.at(-1) as { choices: Array<{ finish_reason: string }> })
        .choices[0]?.finish_reason,
      "stop",
    );
    assert.equal(parseSseFrames(second.text).at(-1)?.data, "[DONE]");

    assert.equal(
      backend.requests().length,
      2,
      "requests() 应按序记录两个请求体",
    );
  } finally {
    await backend.stop();
  }
});

test("openai-responses：首轮 function_call（namespace + 裸名），次轮 output_text", async () => {
  const { backend, baseUrl } = await startBackend("openai-responses", [
    {
      toolCall: {
        namespace: "mcp__any_intercom",
        name: "intercom",
        args: { handle: "A", action: "list" },
      },
    },
    { text: "DONE" },
  ]);
  try {
    const first = await postJson(`${baseUrl}/v1/responses`, {
      model: "fake",
      input: [{ role: "user", content: "列出在线会话" }],
    });
    assert.equal(first.status, 200, first.text);
    const firstEvents = parseSseFrames(first.text).map((frame) => ({
      event: frame.event,
      data: JSON.parse(frame.data) as Record<string, unknown>,
    }));
    assert.deepEqual(
      firstEvents.map((frame) => frame.event),
      ["response.created", "response.output_item.done", "response.completed"],
    );
    const item = firstEvents[1]?.data.item as Record<string, unknown>;
    assert.equal(item.type, "function_call");
    assert.ok(item.call_id, "function_call 必须有 call_id");
    assert.equal(item.namespace, "mcp__any_intercom");
    assert.equal(item.name, "intercom", "name 必须是裸工具名");
    assert.deepEqual(JSON.parse(item.arguments as string), {
      handle: "A",
      action: "list",
    });
    assert.equal(item.status, "completed");

    const second = await postJson(`${baseUrl}/v1/responses`, {
      model: "fake",
      input: [
        { role: "user", content: "列出在线会话" },
        item,
        { type: "function_call_output", call_id: item.call_id, output: "[]" },
      ],
    });
    assert.equal(second.status, 200, second.text);
    const secondEvents = parseSseFrames(second.text).map((frame) => ({
      event: frame.event,
      data: JSON.parse(frame.data) as Record<string, unknown>,
    }));
    assert.deepEqual(
      secondEvents.map((frame) => frame.event),
      ["response.created", "response.output_item.done", "response.completed"],
    );
    const messageItem = secondEvents[1]?.data.item as {
      type: string;
      content: Array<{ type: string; text: string }>;
    };
    assert.equal(messageItem.type, "message");
    assert.equal(messageItem.content[0]?.type, "output_text");
    assert.equal(messageItem.content[0]?.text, "DONE");
  } finally {
    await backend.stop();
  }
});

test("openai-responses：tool 轮缺 namespace 显式报 400", async () => {
  const { backend, baseUrl } = await startBackend("openai-responses", [
    { toolCall: { name: "intercom", args: {} } },
  ]);
  try {
    const response = await postJson(`${baseUrl}/v1/responses`, {
      model: "fake",
      input: [],
    });
    assert.equal(response.status, 400);
    assert.match(response.text, /namespace/);
  } finally {
    await backend.stop();
  }
});

test("anthropic-messages：首轮 tool_use SSE 序列，次轮（含 tool_result）end_turn", async () => {
  const { backend, baseUrl } = await startBackend("anthropic-messages", [
    {
      toolCall: {
        name: "mcp__any_intercom__intercom",
        args: { action: "send", to: "B", message: "hi" },
      },
    },
    { text: "DONE" },
  ]);
  try {
    const first = await postJson(`${baseUrl}/v1/messages`, {
      model: "fake",
      messages: [{ role: "user", content: "给 B 发消息" }],
    });
    assert.equal(first.status, 200, first.text);
    const firstEvents = parseSseFrames(first.text).map((frame) => ({
      event: frame.event,
      data: JSON.parse(frame.data) as Record<string, unknown>,
    }));
    assert.deepEqual(
      firstEvents.map((frame) => frame.event),
      [
        "message_start",
        "content_block_start",
        "content_block_delta",
        "content_block_stop",
        "message_delta",
        "message_stop",
      ],
    );
    const blockStart = firstEvents[1]?.data.content_block as Record<
      string,
      unknown
    >;
    assert.equal(blockStart.type, "tool_use");
    assert.equal(blockStart.name, "mcp__any_intercom__intercom");
    const delta = (firstEvents[2]?.data.delta as Record<string, unknown>) ?? {};
    assert.equal(delta.type, "input_json_delta");
    assert.deepEqual(JSON.parse(delta.partial_json as string), {
      action: "send",
      to: "B",
      message: "hi",
    });
    assert.equal(
      ((firstEvents[4]?.data.delta as Record<string, unknown>) ?? {})
        .stop_reason,
      "tool_use",
    );

    const second = await postJson(`${baseUrl}/v1/messages`, {
      model: "fake",
      messages: [
        { role: "user", content: "给 B 发消息" },
        { role: "assistant", content: [blockStart] },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: blockStart.id, content: "ok" },
          ],
        },
      ],
    });
    assert.equal(second.status, 200, second.text);
    const secondEvents = parseSseFrames(second.text).map((frame) => ({
      event: frame.event,
      data: JSON.parse(frame.data) as Record<string, unknown>,
    }));
    assert.deepEqual(
      secondEvents.map((frame) => frame.event),
      [
        "message_start",
        "content_block_start",
        "content_block_delta",
        "content_block_stop",
        "message_delta",
        "message_stop",
      ],
    );
    assert.equal(
      (secondEvents[1]?.data.content_block as Record<string, unknown>).type,
      "text",
    );
    const textDelta = secondEvents[2]?.data.delta as {
      type: string;
      text: string;
    };
    assert.equal(textDelta.type, "text_delta");
    assert.equal(textDelta.text, "DONE");
    assert.equal(
      ((secondEvents[4]?.data.delta as Record<string, unknown>) ?? {})
        .stop_reason,
      "end_turn",
    );
  } finally {
    await backend.stop();
  }
});

test("gemini-generate：非流式首轮 functionCall；流式次轮（含 functionResponse）文本", async () => {
  const { backend, baseUrl } = await startBackend("gemini-generate", [
    {
      toolCall: {
        name: "mcp_any_intercom_intercom",
        args: { handle: "A", action: "list" },
      },
    },
    { text: "DONE" },
  ]);
  try {
    const first = await postJson(
      `${baseUrl}/v1beta/models/fake:generateContent`,
      {
        contents: [{ role: "user", parts: [{ text: "列出在线会话" }] }],
      },
    );
    assert.equal(first.status, 200, first.text);
    const firstBody = JSON.parse(first.text) as {
      candidates: Array<{ content: { parts: Array<Record<string, unknown>> } }>;
    };
    const functionCall = firstBody.candidates[0]?.content.parts[0]
      ?.functionCall as {
      name: string;
      args: unknown;
    };
    assert.equal(functionCall.name, "mcp_any_intercom_intercom");
    assert.deepEqual(functionCall.args, { handle: "A", action: "list" });

    const second = await postJson(
      `${baseUrl}/v1beta/models/fake:streamGenerateContent`,
      {
        contents: [
          { role: "user", parts: [{ text: "列出在线会话" }] },
          { role: "model", parts: [{ functionCall: functionCall }] },
          {
            role: "user",
            parts: [
              {
                functionResponse: {
                  name: functionCall.name,
                  response: { result: "[]" },
                },
              },
            ],
          },
        ],
      },
    );
    assert.equal(second.status, 200, second.text);
    const frames = parseSseFrames(second.text);
    assert.equal(frames.length, 1, "流式应只有一帧 data: <json>");
    const streamed = JSON.parse(frames[0]!.data) as {
      candidates: Array<{ content: { parts: Array<{ text?: string }> } }>;
    };
    assert.equal(streamed.candidates[0]?.content.parts[0]?.text, "DONE");
  } finally {
    await backend.stop();
  }
});

test("requests() 按序记录请求体；dumpPath 全量落盘 JSONL", async () => {
  const dir = await mkdtemp(join(os.tmpdir(), "xas-llm-fixture-"));
  const dumpPath = join(dir, "requests.jsonl");
  const { backend, baseUrl } = await startBackend(
    "openai-chat",
    [{ text: "A" }, { text: "B" }],
    dumpPath,
  );
  try {
    const bodies = [
      { model: "fake", messages: [{ role: "user", content: "一" }] },
      {
        model: "fake",
        messages: [
          { role: "user", content: "一" },
          { role: "tool", tool_call_id: "call_1", content: "二" },
        ],
      },
    ];
    for (const body of bodies) {
      const response = await postJson(`${baseUrl}/v1/chat/completions`, body);
      assert.equal(response.status, 200, response.text);
    }
    assert.deepEqual(backend.requests(), bodies);

    const dumped = (await readFile(dumpPath, "utf8"))
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as unknown);
    assert.deepEqual(dumped, bodies);
  } finally {
    await backend.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("端点匹配剥离 query string", async () => {
  const { backend, baseUrl } = await startBackend("anthropic-messages", [
    { text: "OK" },
  ]);
  try {
    const response = await postJson(`${baseUrl}/v1/messages?beta=true`, {
      model: "fake",
      messages: [{ role: "user", content: "hi" }],
    });
    assert.equal(response.status, 200, response.text);
    assert.equal(backend.requests().length, 1);
  } finally {
    await backend.stop();
  }
});

test("脚本耗尽与未知路径显式报错", async () => {
  const { backend, baseUrl } = await startBackend("openai-chat", [
    { text: "仅此一轮" },
  ]);
  try {
    const exhausted = await postJson(`${baseUrl}/v1/chat/completions`, {
      model: "fake",
      messages: [{ role: "tool", tool_call_id: "call_1", content: "x" }],
    });
    assert.equal(exhausted.status, 400);
    assert.match(exhausted.text, /脚本/);

    const notFound = await postJson(`${baseUrl}/v1/unknown-endpoint`, {});
    assert.equal(notFound.status, 404);
  } finally {
    await backend.stop();
  }
});

test("createLlmBackend：fixture 返回 FakeProviderBackend，未知模式显式抛错", () => {
  const backend = createLlmBackend("fixture", {
    wire: "openai-chat",
    script: [{ text: "x" }],
  });
  assert.ok(backend instanceof FakeProviderBackend);
  assert.equal(backend.mode, "fixture");
  assert.throws(
    () =>
      createLlmBackend("bogus", { wire: "openai-chat", script: [] } as never),
    /fixture/,
  );
});
