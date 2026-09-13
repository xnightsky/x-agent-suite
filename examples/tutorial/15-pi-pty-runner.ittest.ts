/**
 * 教程：真实 Pi PTY driver 接入 runner（零 token）。
 * 场景：ScenarioSpec → runScenarioSpec → PtyAgentDriver（真实 Pi TUI + 假端点）
 *   → runCriteria → ScenarioResult；验证 runner 的 AgentDriver 契约与真实宿主兼容。
 * 不变量：默认 skip；显式设置 E2E_PI_PTY=1 后才启动真实 Pi CLI；模型请求只连本机假端点。
 * 注意：本文件是教程示例，不是框架 API。
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { textContains } from "@x-agent-suite/criteria";
import { createPtyAgentDriver } from "@x-agent-suite/harness";
import { FakeProviderBackend } from "@x-agent-suite/llm-fixture";
import { runScenarioSpec } from "@x-agent-suite/runner";
import { piProfile } from "../../packages/harness/tests/fixtures/profiles/pi.ts";
import { printTutorialSummary } from "./support.ts";

test(
  "Pi PTY × runner：真实 TUI 经 runScenarioSpec 跑通判据调度",
  {
    skip: process.env.E2E_PI_PTY !== "1",
    timeout: 90_000,
  },
  async () => {
    const backend = new FakeProviderBackend({
      wire: "openai-chat",
      script: [{ text: "PI_PTY_OK" }],
    });
    const result = await runScenarioSpec(
      {
        id: "tutorial/pi-pty-runner",
        timeoutMs: 60_000,
        turns: [
          {
            send: "reply PI_PTY_OK only",
            expect: { "text-contains": ["PI_PTY_OK"] },
          },
        ],
      },
      {
        createDriver: () =>
          createPtyAgentDriver({
            profile: piProfile,
            backend,
            injectServer: false,
            sandboxSetup: async (sandbox) => {
              const projectConfigDir = join(sandbox.cwd, ".pi");
              await mkdir(projectConfigDir, { recursive: true });
              await writeFile(
                join(projectConfigDir, "settings.json"),
                '{"quietStartup":false}\n',
                "utf8",
              );
            },
            readyTimeoutMs: 30_000,
            promptTimeoutMs: 30_000,
          }),
        criteria: [textContains],
      },
    );

    assert.equal(result.hardPass, true);
    assert.equal(backend.requests().length, 1);
    printTutorialSummary({
      recipe: "pi-pty-runner",
      hardPass: result.hardPass,
      backendRequests: backend.requests().length,
    });
  },
);
