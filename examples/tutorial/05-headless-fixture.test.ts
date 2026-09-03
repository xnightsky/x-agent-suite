/**
 * @module examples/tutorial/05-headless-fixture
 * 合成 headless profile + loopback 假端点：演示完整 HarnessDriver 接缝。
 * 不变量：只拉起通用 Node 测试进程，不依赖真实宿主 CLI，不消耗 token。
 */
import type { HarnessProfile, ParsedEvent } from "@x-agent-suite/contracts";
import { createHarnessDriver } from "@x-agent-suite/harness";
import { FakeProviderBackend } from "@x-agent-suite/llm-fixture";
import { fileURLToPath } from "node:url";
import { printTutorialSummary, tutorialPathExists } from "./support.ts";

const CHILD_SOURCE = String.raw`
const endpoint = process.env.TUTORIAL_BASE_URL + "/v1/chat/completions";
const prompt = process.argv[1];
async function post(messages) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "tutorial", messages }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error("fixture response: " + text);
  return text;
}
const first = await post([{ role: "user", content: prompt }]);
if (!first.includes("demo_tool")) throw new Error("missing tool call");
const second = await post([
  { role: "user", content: prompt },
  {
    role: "assistant",
    tool_calls: [{
      id: "call_1",
      type: "function",
      function: { name: "demo_tool", arguments: "{\"id\":\"42\"}" },
    }],
  },
  { role: "tool", tool_call_id: "call_1", content: "ok" },
]);
if (!second.includes("HEADLESS_DONE")) throw new Error("missing final text");
process.stdout.write(JSON.stringify({
  type: "tool_call",
  payload: { name: "demo_tool", input: { id: "42" }, status: "completed" },
}) + "\n");
process.stdout.write(JSON.stringify({
  type: "text",
  payload: { text: "HEADLESS_DONE" },
}) + "\n");
process.stdout.write(JSON.stringify({ type: "result", payload: { steps: 2 } }) + "\n");
`;

function parseTutorialEvent(line: unknown): ParsedEvent | null {
  if (typeof line !== "object" || line === null) return null;
  const record = line as { type?: unknown; payload?: unknown };
  if (typeof record.type !== "string") return null;
  return { type: record.type, payload: record.payload };
}

const profile: HarnessProfile = {
  name: "tutorial-headless",
  command: process.execPath,
  headlessArgs: (prompt) => ["-e", CHILD_SOURCE, prompt],
  wire: "openai-chat",
  baseUrlEnv: "TUTORIAL_BASE_URL",
  apiKeyEnv: "TUTORIAL_API_KEY",
  stripEnv: [],
  toolName: (_server, tool) => tool,
  writeConfig: async () => {},
  createParser: () => parseTutorialEvent,
  supportsFixture: true,
};

const backend = new FakeProviderBackend({
  wire: profile.wire,
  script: [
    { toolCall: { name: "demo_tool", args: { id: "42" } } },
    { text: "HEADLESS_DONE" },
  ],
});
const driver = createHarnessDriver(profile, backend, {
  serverEntry: fileURLToPath(import.meta.url),
  commandOverride: { command: process.execPath, argsPrefix: [] },
});

let homeDir = "";
let cwd = "";
let observation;
try {
  await driver.start();
  ({ homeDir, cwd } = driver.sandbox);
  observation = await driver.sendPrompt("perform item 42");
} finally {
  await driver.close("headless tutorial complete");
}
if (!observation) throw new Error("headless 教程未产生 Observation");
if (backend.requests().length !== 2) {
  throw new Error(`headless 教程请求轮次错误：${driver.stderrTail()}`);
}

printTutorialSummary({
  recipe: "headless-fixture",
  text: observation.text,
  toolCallsCount: observation.toolCallsCount,
  backendRequests: backend.requests().length,
  stderrTail: driver.stderrTail(),
  cleaned:
    !(await tutorialPathExists(homeDir)) && !(await tutorialPathExists(cwd)),
});
