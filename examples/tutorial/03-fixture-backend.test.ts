/**
 * @module examples/tutorial/03-fixture-backend
 * loopback 模型脚本：FakeProviderBackend 的工具轮与文本收尾轮。
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  createLlmBackend,
  FakeProviderBackend,
} from "@x-agent-suite/llm-fixture";
import { printTutorialSummary, resolveTutorialOutDir } from "./support.ts";

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const outDir = resolveTutorialOutDir(".tmp/tutorial/fixture-backend");
await mkdir(outDir, { recursive: true });
const backend = createLlmBackend("fixture", {
  wire: "openai-chat",
  script: [
    { toolCall: { name: "demo_tool", args: { id: "42" } } },
    { text: "FINISHED" },
  ],
  dumpPath: join(outDir, "requests.jsonl"),
});
if (!(backend instanceof FakeProviderBackend)) {
  throw new Error("fixture 工厂未返回 FakeProviderBackend");
}

let firstText = "";
let secondText = "";
try {
  const { baseUrl } = await backend.start();
  const first = await postJson(`${baseUrl}/v1/chat/completions`, {
    model: "tutorial-fixture",
    messages: [{ role: "user", content: "perform item 42" }],
  });
  firstText = await first.text();
  const second = await postJson(`${baseUrl}/v1/chat/completions`, {
    model: "tutorial-fixture",
    messages: [
      { role: "user", content: "perform item 42" },
      {
        role: "assistant",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "demo_tool", arguments: '{"id":"42"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: "ok" },
    ],
  });
  secondText = await second.text();
} finally {
  await backend.stop();
}

printTutorialSummary({
  recipe: "fixture-backend",
  toolCallSeen: firstText.includes("demo_tool"),
  finalTextSeen: secondText.includes("FINISHED"),
  requestCount: backend.requests().length,
});
