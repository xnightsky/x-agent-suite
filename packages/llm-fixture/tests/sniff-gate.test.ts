/**
 * @module @x-agent-suite/llm-fixture/tests/sniff-gate
 * 嗅探门禁（sniff-gate）测试：live 开跑前的最小真实调用闸。
 * 不变量：被嗅探端一律为 FakeProviderBackend（loopback，零 token），
 * 失败路径用注入 transport 模拟；任何失败返回结构化 SniffResult，不得抛裸错。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FakeProviderBackend,
  sniffLiveChannel,
} from "@x-agent-suite/llm-fixture";
import type { FixtureTurn } from "@x-agent-suite/contracts";
import type { LiveChannel, LiveTransport } from "@x-agent-suite/llm-fixture";

async function sniffAgainstFake(
  wire: LiveChannel["wire"],
  script: readonly FixtureTurn[],
) {
  const backend = new FakeProviderBackend({ wire, script });
  const { baseUrl, apiKey } = await backend.start();
  try {
    const channel: LiveChannel = {
      wire,
      baseUrl: `${baseUrl}/v1`,
      model: "fake",
      apiKey,
    };
    const result = await sniffLiveChannel("test-carrier", channel);
    return { result, backend };
  } finally {
    await backend.stop();
  }
}

test("sniff 通过：openai-chat 假端点下发工具调用 → ok 且回报模型标识", async () => {
  const { result, backend } = await sniffAgainstFake("openai-chat", [
    { toolCall: { name: "__e2e_sniff_probe", args: { echo: "ping" } } },
  ]);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (result.ok) {
    assert.equal(result.carrier, "test-carrier");
    assert.equal(result.modelReported, "fake", "应尽力回报响应中的 model 字段");
    assert.ok(result.latencyMs >= 0);
  }
  assert.equal(backend.requests().length, 1, "sniff 只发一轮最小调用");
});

test("sniff 通过：anthropic-messages 假端点 tool_use 轮 → ok", async () => {
  const { result } = await sniffAgainstFake("anthropic-messages", [
    { toolCall: { name: "__e2e_sniff_probe", args: { echo: "ping" } } },
  ]);
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("sniff 通过：openai-responses / gemini-generate 假端点工具轮 → ok", async () => {
  const responses = await sniffAgainstFake("openai-responses", [
    {
      toolCall: {
        namespace: "mcp__sniff",
        name: "__e2e_sniff_probe",
        args: { echo: "ping" },
      },
    },
  ]);
  assert.equal(responses.result.ok, true, JSON.stringify(responses.result));
  const gemini = await sniffAgainstFake("gemini-generate", [
    { toolCall: { name: "__e2e_sniff_probe", args: { echo: "ping" } } },
  ]);
  assert.equal(gemini.result.ok, true, JSON.stringify(gemini.result));
});

test("tool calling 不过：假端点只回文本 → 结构化失败 stage=tool-calling", async () => {
  const { result } = await sniffAgainstFake("openai-chat", [
    { text: "我不会调用工具" },
  ]);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.stage, "tool-calling");
    assert.match(result.reason, /工具调用/);
  }
});

test("真实 anthropic 一次性响应形态：顶层 type=message + thinking 块 → 仍能解析出 tool_use", async () => {
  const realShaped = JSON.stringify({
    id: "msg_01",
    type: "message",
    role: "assistant",
    content: [
      { type: "thinking", thinking: "准备调用探针", signature: "sig" },
      { type: "text", text: "" },
      {
        type: "tool_use",
        id: "toolu_01",
        name: "__e2e_sniff_probe",
        input: { echo: "ping" },
      },
    ],
    model: "claude-opus-4-8",
    stop_reason: "tool_use",
    usage: { input_tokens: 10, output_tokens: 20 },
  });
  const transport: LiveTransport = async () => ({
    status: 200,
    text: realShaped,
  });
  const channel: LiveChannel = {
    wire: "anthropic-messages",
    baseUrl: "https://x.example.com/v1",
    model: "m",
    apiKey: "sk-x",
  };
  const result = await sniffLiveChannel("claude", channel, { transport });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (result.ok) assert.equal(result.modelReported, "claude-opus-4-8");
});

test("鉴权不过：注入 transport 返回 401 → stage=auth", async () => {
  const transport: LiveTransport = async () => ({
    status: 401,
    text: '{"error":"invalid api key"}',
  });
  const channel: LiveChannel = {
    wire: "openai-chat",
    baseUrl: "https://secret-host.example.com/v1",
    model: "m",
    apiKey: "sk-secret",
  };
  const result = await sniffLiveChannel("kimi", channel, { transport });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.stage, "auth");
    assert.ok(result.reason.includes("401"));
  }
});

test("连通不过：注入 transport 抛错 → stage=connectivity，reason 脱敏 baseUrl/key，不抛裸错", async () => {
  const transport: LiveTransport = async (req) => {
    throw new Error(`connect ECONNREFUSED ${req.url} authorization=sk-secret`);
  };
  const channel: LiveChannel = {
    wire: "openai-chat",
    baseUrl: "https://secret-host.example.com/v1",
    model: "m",
    apiKey: "sk-secret",
  };
  const result = await sniffLiveChannel("kimi", channel, { transport });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.stage, "connectivity");
    assert.ok(
      !result.reason.includes("secret-host.example.com"),
      `reason 不得含 baseUrl：${result.reason}`,
    );
    assert.ok(
      !result.reason.includes("sk-secret"),
      `reason 不得含 apiKey：${result.reason}`,
    );
  }
});

test("连通错误会脱敏 apiKeyEnv 与 borrowCredential 解析出的真实凭证", async () => {
  const token = "resolved-secret-token";
  const transport: LiveTransport = async (request) => {
    throw new Error(`transport headers=${JSON.stringify(request.headers)}`);
  };
  const fromEnv = await sniffLiveChannel(
    "env-carrier",
    {
      wire: "openai-chat",
      baseUrl: "https://env.example.com/v1",
      model: "m",
      apiKeyEnv: "LIVE_TOKEN",
    },
    { env: { LIVE_TOKEN: token }, transport },
  );
  assert.equal(fromEnv.ok, false);
  if (!fromEnv.ok) assert.ok(!fromEnv.reason.includes(token), fromEnv.reason);

  const borrowed = await sniffLiveChannel(
    "borrowed-carrier",
    {
      wire: "openai-chat",
      baseUrl: "https://borrowed.example.com/v1",
      model: "m",
      from: "harness",
      credential: "harness",
    },
    {
      transport,
      borrowChannel: async () => ({
        kind: "resolved",
        wire: "openai-chat",
        baseUrl: "https://borrowed.example.com/v1",
        model: "m",
        source: "test",
      }),
      borrowCredential: async () => ({
        kind: "resolved",
        apiKey: token,
        source: "test",
      }),
    },
  );
  assert.equal(borrowed.ok, false);
  if (!borrowed.ok)
    assert.ok(!borrowed.reason.includes(token), borrowed.reason);
});

test("sniff 在借用渠道不匹配时不解析凭据也不调用 transport", async () => {
  let credentialCalls = 0;
  let transportCalls = 0;
  const result = await sniffLiveChannel(
    "borrowed-carrier",
    {
      wire: "openai-chat",
      baseUrl: "https://redirect.example.com/v1",
      model: "m",
      from: "harness",
      credential: "harness",
    },
    {
      borrowChannel: async () => ({
        kind: "resolved",
        wire: "openai-chat",
        baseUrl: "https://borrowed.example.com/v1",
        model: "m",
        source: "test",
      }),
      borrowCredential: async () => {
        credentialCalls += 1;
        return { kind: "resolved", apiKey: "secret-token", source: "test" };
      },
      transport: async () => {
        transportCalls += 1;
        return { status: 200, text: "{}" };
      },
    },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.stage, "auth");
  assert.equal(credentialCalls, 0);
  assert.equal(transportCalls, 0);
});

test("HTTP 5xx → stage=connectivity；sniff 超时也归 connectivity", async () => {
  const channel: LiveChannel = {
    wire: "openai-chat",
    baseUrl: "https://x.example.com/v1",
    model: "m",
  };
  const server5xx = await sniffLiveChannel("kimi", channel, {
    transport: async () => ({ status: 502, text: "bad gateway" }),
  });
  assert.equal(server5xx.ok, false);
  if (!server5xx.ok) assert.equal(server5xx.stage, "connectivity");

  const hung = await sniffLiveChannel("kimi", channel, {
    timeoutMs: 50,
    transport: () => new Promise(() => {}),
  });
  assert.equal(hung.ok, false);
  if (!hung.ok) {
    assert.equal(hung.stage, "connectivity");
    assert.match(hung.reason, /超时/);
  }
});
