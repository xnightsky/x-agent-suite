import assert from "node:assert/strict";
import test from "node:test";
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
