import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { inspect } from "node:util";
import {
  buildLiveRequest,
  createFetchTransport,
  LiveBackend,
} from "@x-agent-suite/llm-fixture";

test("LiveBackend.complete 将可选 signal 透传到 LiveRequest", async () => {
  const controller = new AbortController();
  let seen: AbortSignal | undefined;
  const backend = new LiveBackend({
    carrier: "fixture",
    channel: {
      wire: "openai-chat",
      baseUrl: "https://fixture.invalid/v1",
      model: "fixture",
      apiKey: "secret",
    },
    transport: async (request) => {
      seen = request.signal;
      return {
        status: 200,
        text: '{"choices":[{"message":{"content":"ok"}}]}',
      };
    },
  });
  await backend.start();
  await backend.complete({
    messages: [{ role: "user", text: "hello" }],
    signal: controller.signal,
  });
  assert.equal(seen, controller.signal);
});

test("createFetchTransport 将 request.signal 交给 fetch，缺省行为不变", async (t) => {
  const controller = new AbortController();
  const fetchMock = t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("{}", { status: 200 }),
  );
  const request = buildLiveRequest("openai-chat", {
    baseUrl: "https://fixture.invalid/v1",
    model: "fixture",
    messages: [{ role: "user", text: "hello" }],
    signal: controller.signal,
  });
  await createFetchTransport()(request);
  assert.equal(
    fetchMock.mock.calls[0]?.arguments[1]?.signal,
    controller.signal,
  );
});

test("createFetchTransport 默认禁止重定向并脱敏 fetch 错误", async (t) => {
  const secret = "synthetic-redirect-secret";
  const baseUrl = "https://private-redirect.example.com/v1";
  const request = buildLiveRequest("openai-chat", {
    baseUrl,
    model: "fixture",
    messages: [{ role: "user", text: "hello" }],
    apiKey: secret,
  });
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error(
      `redirect failed for ${request.url} authorization=Bearer ${secret}`,
    );
  });
  let failure: unknown;
  try {
    await createFetchTransport()(request);
  } catch (error) {
    failure = error;
  }
  const init = fetchMock.mock.calls[0]?.arguments[1];
  assert.equal(init?.redirect, "error");
  const diagnostic = inspect(failure, { depth: 10 });
  assert.doesNotMatch(diagnostic, new RegExp(secret));
  assert.doesNotMatch(diagnostic, /private-redirect\.example\.com/);
  assert.match(diagnostic, /\[REDACTED\]/);
});

test("跨源重定向由默认 transport 拒绝，目标 origin 不收到请求", async () => {
  let targetHits = 0;
  const target = createServer((_req, res) => {
    targetHits += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
  await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
  const targetPort = (target.address() as AddressInfo).port;
  const redirector = createServer((_req, res) => {
    res.writeHead(302, {
      location: `http://127.0.0.1:${targetPort}/capture`,
    });
    res.end();
  });
  await new Promise<void>((resolve) =>
    redirector.listen(0, "127.0.0.1", resolve),
  );
  const redirectorPort = (redirector.address() as AddressInfo).port;
  try {
    const secret = "synthetic-redirect-integration-secret";
    const request = buildLiveRequest("anthropic-messages", {
      baseUrl: `http://127.0.0.1:${redirectorPort}/v1`,
      model: "fixture",
      messages: [{ role: "user", text: "hello" }],
      apiKey: secret,
    });
    let failure: unknown;
    try {
      await createFetchTransport()(request);
    } catch (error) {
      failure = error;
    }
    assert.ok(failure, "redirect:error 必须显式失败");
    assert.equal(targetHits, 0, "跨源目标不得收到请求");
    assert.doesNotMatch(inspect(failure, { depth: 10 }), new RegExp(secret));
  } finally {
    await Promise.all([
      new Promise<void>((resolve, reject) =>
        redirector.close((error) => (error ? reject(error) : resolve())),
      ),
      new Promise<void>((resolve, reject) =>
        target.close((error) => (error ? reject(error) : resolve())),
      ),
    ]);
  }
});
