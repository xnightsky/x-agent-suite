/**
 * 教程：harness driver 接 runner 主链（合成 profile + 假端点，零 token）。
 * 场景：ScenarioSpec → runScenarioSpec → createHarnessDriver（合成 headless）
 *   → runCriteria（text-contains + tool-call）→ resolveAggregate → 出口分。
 * 运行：pnpm tutorial:harness-runner（或 pnpm test 中自动跑）。
 * 覆盖对象：@x-agent-suite/runner 与 @x-agent-suite/harness 的接线。
 * 注意：本文件是教程示例，不是框架 API；只拉起通用 Node 测试进程。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { HarnessProfile, ParsedEvent } from "@x-agent-suite/contracts";
import { textContains, toolCall } from "@x-agent-suite/criteria";
import { createHarnessDriver } from "@x-agent-suite/harness";
import { FakeProviderBackend } from "@x-agent-suite/llm-fixture";
import { runScenarioSpec, type RunnerArtifact } from "@x-agent-suite/runner";
import { printTutorialSummary } from "./support.ts";

/** 通用 Node 子进程扮演的「宿主」：两轮 fake 对话后输出 JSONL 事件。 */
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
if (!second.includes("RUNNER_OK")) throw new Error("missing final text");
process.stdout.write(JSON.stringify({
  type: "tool_call",
  payload: { name: "demo_tool", input: { id: "42" }, status: "completed" },
}) + "\n");
process.stdout.write(JSON.stringify({
  type: "text",
  payload: { text: "RUNNER_OK" },
}) + "\n");
process.stdout.write(JSON.stringify({ type: "result", payload: { steps: 2 } }) + "\n");
`;

/** 逐行解析子进程 JSONL 事件。 */
function parseTutorialEvent(line: unknown): ParsedEvent | null {
  if (typeof line !== "object" || line === null) return null;
  const record = line as { type?: unknown; payload?: unknown };
  if (typeof record.type !== "string") return null;
  return { type: record.type, payload: record.payload };
}

/** 合成 headless profile（与 05-headless-fixture 同款形态）。 */
const profile: HarnessProfile = {
  name: "tutorial-harness-runner",
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

test("tutorial/harness-runner：harness driver 全链接入 runScenarioSpec", async () => {
  const result = await runScenarioSpec(
    {
      id: "tutorial/harness-runner",
      turns: [
        {
          send: "perform item 42",
          expect: {
            "text-contains": ["RUNNER_OK"],
            "tool-call": { tool: "demo_tool", args: { id: "42" } },
          },
        },
      ],
      aggregate: {
        dimensions: [
          { metric: "text-contains", weight: 1 },
          { metric: "tool-call", weight: 2 },
          { metric: "style", weight: 1 },
        ],
        threshold: 0.5,
      },
    },
    {
      createDriver: () =>
        createHarnessDriver(
          profile,
          new FakeProviderBackend({
            wire: profile.wire,
            script: [
              { toolCall: { name: "demo_tool", args: { id: "42" } } },
              { text: "RUNNER_OK" },
            ],
          }),
          {
            serverEntry: fileURLToPath(import.meta.url),
            commandOverride: { command: process.execPath, argsPrefix: [] },
          },
        ),
      criteria: [textContains, toolCall],
    },
  );

  const artifact = result.artifact as RunnerArtifact;
  assert.equal(result.hardPass, true);
  assert.equal(artifact.outcomes.length, 2);
  assert.ok(artifact.aggregate);
  assert.equal(artifact.aggregate.score, 1);
  assert.deepEqual(artifact.aggregate.coverage, { evaluated: 2, total: 3 });

  printTutorialSummary({
    recipe: "harness-runner",
    hardPass: result.hardPass,
    score: artifact.aggregate.score,
    coverage: artifact.aggregate.coverage,
    states: artifact.aggregate.dimensions.map((dimension) => dimension.state),
  });
});
