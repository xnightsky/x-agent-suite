/**
 * @module examples/tutorial/11-pi-live-pty
 * 真实 Pi PTY 打真实 provider 的 token 证据：沙盒 HOME + live 分支注入借用渠道。
 * 渠道与凭据来自真实 home 的 ~/.env.e2e.yaml；默认执行 carriers.pi.default，
 * --model 从可选目录选择唯一目标。每个 target 使用独立 backend 与 sandbox。
 * 不变量：文件不进默认 runner；即使显式运行，也必须再通过单次授权值；
 * 会产生真实 token、费用与数据出站；诊断输出必须脱敏。
 */
import assert from "node:assert/strict";
import os from "node:os";
import { resolve } from "node:path";
import { test, type TestContext } from "node:test";
import {
  createHarnessLiveConfigHooks,
  createPtyAgentDriver,
} from "@x-agent-suite/harness";
import {
  LiveBackend,
  loadLiveConfig,
  redactLiveSecrets,
  resolveLiveTargets,
  type ResolvedLiveTarget,
} from "@x-agent-suite/llm-fixture";
import { piProfile } from "../../packages/harness/tests/fixtures/profiles/pi.ts";
import { PI_TOKEN_MODEL_ENV } from "../../scripts/run-pi-token-ittest.ts";

const AUTHORIZATION_ENV = "XAS_TUTORIAL_LIVE_AUTHORIZATION";
const AUTHORIZATION_VALUE = "I_ACCEPT_LIVE_COST_AND_DATA_EGRESS";
const authorized = process.env[AUTHORIZATION_ENV] === AUTHORIZATION_VALUE;

/** 对一个完整 target 启动独立 PTY，并断言实际 footer 与选择模型一致。 */
async function runPiTarget(
  t: TestContext,
  homeDir: string,
  hooks: ReturnType<typeof createHarnessLiveConfigHooks>,
  target: ResolvedLiveTarget,
): Promise<void> {
  const { carrier, channel } = target;
  t.diagnostic(
    redactLiveSecrets(
      `channel: wire=${channel.wire} model=${channel.model} ` +
        `provider=${channel.provider ?? "-"} from=${channel.from ?? "-"}`,
      [channel],
    ),
  );
  const backend = new LiveBackend({
    carrier,
    channel,
    config: { env: {}, homeDir, ...hooks },
  });
  const driver = createPtyAgentDriver({
    profile: piProfile,
    backend,
    injectServer: false,
    readyTimeoutMs: 60_000,
    promptTimeoutMs: 120_000,
  });
  try {
    await driver.start();
    assert.ok(
      driver.screenTail().includes(channel.model),
      `footer 未出现声明模型 ${channel.model}`,
    );
    const observation = await driver.sendPrompt("hi");
    assert.ok(observation.text.trim().length > 0, "真实 provider 未返回文本");
    t.diagnostic(`reply length: ${observation.text.trim().length}`);
  } finally {
    await driver.close("Pi live PTY token test complete");
  }
}

test(
  "Pi live PTY：默认或显式 target 经真实 TUI 完成对话并清理",
  {
    skip: authorized
      ? false
      : `需要显式设置 ${AUTHORIZATION_ENV}=${AUTHORIZATION_VALUE}`,
  },
  async (t) => {
    const selectedModel = process.env[PI_TOKEN_MODEL_ENV];
    const homeDir = os.homedir();
    const hooks = createHarnessLiveConfigHooks();
    const loaded = await loadLiveConfig({ env: {}, homeDir, ...hooks });
    if (loaded.kind === "loaded") {
      for (const warning of loaded.warnings) {
        t.diagnostic(`[${warning.code}] ${warning.message}`);
      }
    }
    const resolved = resolveLiveTargets(loaded, {
      carrier: "pi",
      ...(selectedModel ? { model: selectedModel } : {}),
    });
    if (resolved.kind !== "configured") {
      if (selectedModel)
        throw new Error(redactLiveSecrets(resolved.reason, []));
      t.skip(redactLiveSecrets(resolved.reason, []));
      return;
    }

    for (const target of resolved.targets) {
      const name = `${target.channel.provider ?? "-"}/${target.channel.model}`;
      await t.test(name, { timeout: 180_000 }, async (subtest) => {
        await runPiTarget(subtest, homeDir, hooks, target);
      });
    }
  },
);
