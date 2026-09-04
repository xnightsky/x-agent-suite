/**
 * @module @x-agent-suite/llm-fixture/tests/live-backend
 * LiveBackend 测试：零真实 token，对端一律为 FakeProviderBackend 或注入 transport。
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { inspect } from "node:util";
import { stringify as stringifyYaml } from "yaml";
import {
  createLlmBackend,
  estimateCostUsd,
  FakeProviderBackend,
  LiveBackend,
  LiveNotConfiguredError,
  parseLiveResponse,
} from "@x-agent-suite/llm-fixture";
import type { LiveChannel, LiveTransport } from "@x-agent-suite/llm-fixture";

test("未配置渠道：start 抛 LiveNotConfiguredError（显式类型，供 skip 闸门吸收）", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "xas-live-be-"));
  try {
    const backend = new LiveBackend({
      carrier: "kimi",
      config: {
        env: {},
        repoRoot: join(root, "repo"),
        homeDir: join(root, "home"),
      },
    });
    await assert.rejects(backend.start(), (error: unknown) => {
      assert.ok(error instanceof LiveNotConfiguredError);
      assert.equal((error as LiveNotConfiguredError).carrier, "kimi");
      return true;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("借用凭据被重定向时在 transport 前拒绝", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "xas-live-redirect-"));
  let transportCalls = 0;
  try {
    const repoRoot = join(root, "repo");
    await mkdir(repoRoot, { recursive: true });
    await writeFile(
      join(repoRoot, ".env.e2e.yaml"),
      stringifyYaml({ carriers: { borrowed: { from: "harness" } } }),
    );
    const backend = new LiveBackend({
      carrier: "borrowed",
      transport: async () => {
        transportCalls += 1;
        return { status: 200, text: "{}" };
      },
      config: {
        env: {
          E2E_LIVE_BORROWED_BASE_URL: "https://redirect.example.com/v1",
        },
        repoRoot,
        homeDir: join(root, "home"),
        borrowChannel: async () => ({
          kind: "resolved",
          wire: "openai-chat",
          baseUrl: "https://borrowed.example.com/v1",
          model: "borrowed-model",
          source: "synthetic",
        }),
        borrowCredential: async () => ({
          kind: "resolved",
          apiKey: "synthetic-borrowed-secret",
          source: "synthetic",
        }),
      },
    });
    await assert.rejects(backend.start(), LiveNotConfiguredError);
    assert.equal(transportCalls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("显式 channel 不能把借用凭据重定向到其他端点", async () => {
  let credentialCalls = 0;
  let transportCalls = 0;
  const backend = new LiveBackend({
    carrier: "borrowed",
    channel: {
      wire: "openai-chat",
      baseUrl: "https://redirect.example.com/v1",
      model: "borrowed-model",
      from: "harness",
      credential: "harness",
    },
    transport: async () => {
      transportCalls += 1;
      return { status: 200, text: "{}" };
    },
    config: {
      env: {},
      borrowChannel: async () => ({
        kind: "resolved",
        wire: "openai-chat",
        baseUrl: "https://borrowed.example.com/v1",
        model: "borrowed-model",
        source: "synthetic",
      }),
      borrowCredential: async () => {
        credentialCalls += 1;
        return {
          kind: "resolved",
          apiKey: "synthetic-borrowed-secret",
          source: "synthetic",
        };
      },
    },
  });

  await assert.rejects(backend.start(), LiveNotConfiguredError);
  assert.equal(credentialCalls, 0);
  assert.equal(transportCalls, 0);
});

test("对 FakeProviderBackend（openai-chat）：start 返回声明渠道；complete 两轮拿工具调用与文本", async () => {
  const fake = new FakeProviderBackend({
    wire: "openai-chat",
    script: [
      {
        toolCall: {
          name: "mcp__any_intercom__intercom",
          args: { handle: "A", action: "list" },
        },
      },
      { text: "DONE" },
    ],
  });
  const { baseUrl } = await fake.start();
  try {
    const channel: LiveChannel = {
      wire: "openai-chat",
      baseUrl: `${baseUrl}/v1`,
      model: "fake",
      apiKey: "fake-api-key",
    };
    const backend = new LiveBackend({ carrier: "kimi", channel });
    assert.equal(backend.mode, "live");
    const started = await backend.start();
    assert.equal(started.baseUrl, channel.baseUrl);
    assert.equal(started.apiKey, "fake-api-key");

    const first = await backend.complete({
      messages: [{ role: "user", text: "列出在线会话" }],
      tools: [
        {
          name: "mcp__any_intercom__intercom",
          description: "intercom",
          parameters: { type: "object", properties: {} },
        },
      ],
    });
    assert.equal(first.toolCalls.length, 1);
    assert.equal(first.toolCalls[0]?.name, "mcp__any_intercom__intercom");
    assert.deepEqual(first.toolCalls[0]?.args, { handle: "A", action: "list" });

    const second = await backend.complete({
      messages: [
        { role: "user", text: "列出在线会话" },
        {
          role: "assistant",
          text: "",
          toolCalls: [
            {
              id: first.toolCalls[0]!.id ?? "call_1",
              name: first.toolCalls[0]!.name,
              args: first.toolCalls[0]!.args,
            },
          ],
        },
        {
          role: "tool",
          toolCallId: first.toolCalls[0]!.id ?? "call_1",
          name: first.toolCalls[0]!.name,
          text: "[]",
        },
      ],
    });
    assert.equal(second.text, "DONE");
    await backend.stop();
    await backend.stop();
  } finally {
    await fake.stop();
  }
});

test("transport 异常及响应载荷中的 live secrets 一律脱敏", async () => {
  const secret = "synthetic-live-secret";
  const baseUrl = "https://private-live.example.com/v1";
  const backend = new LiveBackend({
    carrier: "test",
    channel: { wire: "openai-chat", baseUrl, model: "m", apiKey: secret },
    transport: async () => {
      const cause = new Error(`cause=${secret}`);
      cause.stack = `Error: ${secret}\n at ${baseUrl}`;
      const failure = new AggregateError(
        [new Error(`nested=${secret}`), { endpoint: baseUrl }],
        `transport=${secret}`,
        { cause },
      );
      Object.assign(failure, { bodySnippet: `body=${secret}` });
      throw failure;
    },
  });
  await backend.start();
  await assert.rejects(
    backend.complete({ messages: [{ role: "user", text: "hello" }] }),
    (error: unknown) => {
      const diagnostic = inspect(error, { depth: 10 });
      assert.doesNotMatch(diagnostic, /synthetic-live-secret/);
      assert.doesNotMatch(diagnostic, /private-live\.example\.com/);
      assert.match(diagnostic, /\[REDACTED\]/);
      return true;
    },
  );

  const invalidWire = new LiveBackend({
    carrier: "test",
    channel: { wire: secret, baseUrl, model: "m", apiKey: secret },
  });
  await invalidWire.start();
  await assert.rejects(
    invalidWire.complete({ messages: [{ role: "user", text: "hello" }] }),
    (error: unknown) => {
      assert.doesNotMatch(inspect(error, { depth: 10 }), new RegExp(secret));
      return true;
    },
  );

  const echo = new LiveBackend({
    carrier: "test",
    channel: { wire: "openai-chat", baseUrl, model: "m", apiKey: secret },
    transport: async () => ({
      status: 200,
      text: JSON.stringify({
        choices: [{ message: { content: `echo=${secret}` } }],
      }),
    }),
  });
  await echo.start();
  const completion = await echo.complete({
    messages: [{ role: "user", text: "hello" }],
  });
  assert.doesNotMatch(inspect(completion, { depth: 10 }), new RegExp(secret));
});

test("usage 提取与 costUsd 估算：注入 transport 返回带 usage 的非流式 JSON", async () => {
  const transport: LiveTransport = async () => ({
    status: 200,
    text: JSON.stringify({
      id: "chatcmpl-x",
      object: "chat.completion",
      model: "real-model-x",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "OK" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
    }),
  });
  const channel: LiveChannel = {
    wire: "openai-chat",
    baseUrl: "https://x.example.com/v1",
    model: "real-model-x",
    pricing: { inputPerMTokUsd: 2, outputPerMTokUsd: 8 },
  };
  const backend = new LiveBackend({ carrier: "kimi", channel, transport });
  await backend.start();
  const completion = await backend.complete({
    messages: [{ role: "user", text: "hi" }],
  });
  assert.equal(completion.text, "OK");
  assert.equal(completion.model, "real-model-x");
  assert.deepEqual(completion.usage, {
    promptTokens: 120,
    completionTokens: 30,
    totalTokens: 150,
  });
  assert.equal(backend.usages().length, 1, "usages() 应累计各轮 usage");

  const cost = estimateCostUsd(completion.usage!, channel.pricing);
  assert.ok(
    cost !== undefined && Math.abs(cost - 0.00048) < 1e-9,
    `costUsd 估算错误: ${cost}`,
  );
  assert.equal(
    estimateCostUsd(completion.usage!, undefined),
    undefined,
    "无 pricing 时不得编造成本",
  );
  await backend.stop();
});

test("openai-chat 非流式响应保留所有无 index 的 tool_calls", () => {
  const completion = parseLiveResponse(
    "openai-chat",
    200,
    JSON.stringify({
      choices: [
        {
          message: {
            tool_calls: [
              {
                id: "call-a",
                function: { name: "tool_a", arguments: '{"a":1}' },
              },
              {
                id: "call-b",
                function: { name: "tool_b", arguments: '{"b":2}' },
              },
            ],
          },
        },
      ],
    }),
  );

  assert.deepEqual(completion.toolCalls, [
    { id: "call-a", name: "tool_a", args: { a: 1 } },
    { id: "call-b", name: "tool_b", args: { b: 2 } },
  ]);
});

test("SSE 解析兼容 CRLF 事件分隔", () => {
  const body = [
    'data: {"choices":[{"delta":{"content":"A"}}]}',
    "",
    'data: {"choices":[{"delta":{"content":"B"}}]}',
    "",
    "data: [DONE]",
    "",
  ].join("\r\n");
  const completion = parseLiveResponse("openai-chat", 200, body);
  assert.equal(completion.text, "AB");
});

test("complete 必须先 start；HTTP 错误显式抛出且保留状态码", async () => {
  const channel: LiveChannel = {
    wire: "openai-chat",
    baseUrl: "https://x.example.com/v1",
    model: "m",
  };
  const backend = new LiveBackend({
    carrier: "kimi",
    channel,
    transport: async () => ({ status: 500, text: "boom" }),
  });
  await assert.rejects(
    backend.complete({ messages: [{ role: "user", text: "hi" }] }),
    /start/,
  );
  await backend.start();
  await assert.rejects(
    backend.complete({ messages: [{ role: "user", text: "hi" }] }),
    /500/,
  );
  await backend.stop();
});

test("createLlmBackend 工厂：live 需 carrier，返回 LiveBackend；fixture 行为不变", () => {
  const live = createLlmBackend("live", { carrier: "kimi" });
  assert.ok(live instanceof LiveBackend);
  assert.equal(live.mode, "live");
  assert.throws(() => createLlmBackend("live", {} as never), /carrier/);
  const fixture = createLlmBackend("fixture", {
    wire: "openai-chat",
    script: [{ text: "x" }],
  });
  assert.ok(fixture instanceof FakeProviderBackend);
});

test("liveChannel 品牌字段：start 前为 undefined，start 后暴露已解析渠道", async () => {
  const channel: LiveChannel = {
    wire: "openai-chat",
    baseUrl: "https://x.example.com/v1",
    model: "m",
    apiKey: "k",
  };
  const backend = new LiveBackend({ carrier: "kimi", channel });
  assert.equal(backend.liveChannel, undefined);
  await backend.start();
  assert.deepEqual(backend.liveChannel, channel);
  await backend.stop();
});
