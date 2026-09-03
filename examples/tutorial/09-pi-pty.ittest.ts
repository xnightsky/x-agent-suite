/**
 * @module examples/tutorial/09-pi-pty
 * Pi 真实 CLI 的零 token PTY 集成示例：模型请求只连接本机 fake provider。
 * 不变量：默认 skip；显式设置 E2E_PI_PTY=1 后才启动真实 Pi CLI。
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { createPtyAgentDriver } from "@x-agent-suite/harness";
import { FakeProviderBackend } from "@x-agent-suite/llm-fixture";
import { piProfile } from "../../packages/harness/tests/fixtures/profiles/pi.ts";

test(
  "Pi PTY：真实 TUI 完成一轮 fake provider 对话并清理",
  {
    skip: process.env.E2E_PI_PTY !== "1",
    timeout: 60_000,
  },
  async () => {
    const backend = new FakeProviderBackend({
      wire: "openai-chat",
      script: [{ text: "PI_PTY_OK" }],
    });
    const driver = createPtyAgentDriver({
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
    });
    let homeDir = "";
    let cwd = "";

    try {
      await driver.start();
      ({ homeDir, cwd } = driver.sandbox);
      const observation = await driver.sendPrompt("reply PI_PTY_OK only");
      assert.equal(backend.requests().length, 1);
      assert.match(observation.text, /PI_PTY_OK/);
      assert.doesNotMatch(observation.text, /\[Skills\]/);
    } finally {
      await driver.close("Pi PTY integration complete");
    }
    assert.equal(existsSync(homeDir), false);
    assert.equal(existsSync(cwd), false);
  },
);
