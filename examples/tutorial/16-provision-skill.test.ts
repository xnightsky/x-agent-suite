/**
 * 教程：provision 安装态跑通（合成 profile + 假端点，零 token）。
 * 场景：能力包经 sandboxSetup + provisionSandbox 铺进沙箱 home → 宿主进程读取
 *   安装态文件 → runScenarioSpec 判据断言「加载的是安装后的能力」。
 * 运行：pnpm tutorial:provision（或 pnpm test 中自动跑）。
 * 覆盖对象：@x-agent-suite/sandbox 的 provisionSandbox 与 harness 的 sandboxSetup 钩子。
 * 注意：本文件是教程示例，不是框架 API；只拉起通用 Node 测试进程。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { HarnessProfile, ParsedEvent } from "@x-agent-suite/contracts";
import { textContains } from "@x-agent-suite/criteria";
import { createHarnessDriver } from "@x-agent-suite/harness";
import { FakeProviderBackend } from "@x-agent-suite/llm-fixture";
import { runScenarioSpec } from "@x-agent-suite/runner";
import { provisionSandbox } from "@x-agent-suite/sandbox";
import { printTutorialSummary } from "./support.ts";

/** 通用 Node 子进程扮演宿主：先读安装态能力包，再走一轮 fake 对话。 */
const CHILD_SOURCE = String.raw`
import { readFileSync } from "node:fs";
import { join } from "node:path";
const skillPath = join(process.env.HOME, ".agent", "skills", "demo-skill", "SKILL.md");
const skill = readFileSync(skillPath, "utf8");
if (!skill.includes("demo-skill")) throw new Error("installed skill unreadable");
const endpoint = process.env.TUTORIAL_BASE_URL + "/v1/chat/completions";
const response = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    model: "tutorial",
    messages: [{ role: "user", content: process.argv[1] }],
  }),
});
if (!response.ok) throw new Error("fixture response: " + (await response.text()));
process.stdout.write(JSON.stringify({
  type: "text",
  payload: { text: "SKILL_LOADED:" + skill.split("\n")[0] },
}) + "\n");
process.stdout.write(JSON.stringify({ type: "result", payload: { steps: 1 } }) + "\n");
`;

/** 逐行解析子进程 JSONL 事件。 */
function parseTutorialEvent(line: unknown): ParsedEvent | null {
  if (typeof line !== "object" || line === null) return null;
  const record = line as { type?: unknown; payload?: unknown };
  if (typeof record.type !== "string") return null;
  return { type: record.type, payload: record.payload };
}

const profile: HarnessProfile = {
  name: "tutorial-provision",
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

const SKILL_SOURCE = join(import.meta.dirname, "fixtures", "demo-skill");

test("tutorial/provision：安装态能力包经 sandboxSetup 铺入并被宿主读取", async () => {
  const backend = new FakeProviderBackend({
    wire: profile.wire,
    script: [{ text: "SKILL_OK" }],
  });
  const result = await runScenarioSpec(
    {
      id: "tutorial/provision",
      turns: [
        {
          send: "加载 demo-skill",
          expect: { "text-contains": ["SKILL_LOADED:# demo-skill"] },
        },
      ],
    },
    {
      createDriver: () =>
        createHarnessDriver(profile, backend, {
          serverEntry: fileURLToPath(import.meta.url),
          commandOverride: { command: process.execPath, argsPrefix: [] },
          sandboxSetup: (sandbox) =>
            provisionSandbox(sandbox, [
              { source: SKILL_SOURCE, target: ".agent/skills/demo-skill" },
            ]),
        }),
      criteria: [textContains],
    },
  );

  assert.equal(result.hardPass, true);
  assert.equal(backend.requests().length, 1);
  printTutorialSummary({
    recipe: "provision-skill",
    hardPass: result.hardPass,
    backendRequests: backend.requests().length,
  });
});
