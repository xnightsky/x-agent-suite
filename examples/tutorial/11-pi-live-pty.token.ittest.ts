/**
 * @module examples/tutorial/11-pi-live-pty
 * 真实 Pi PTY 打真实 provider 的 token 证据：沙盒 HOME + live 分支注入借用渠道。
 * 渠道与凭据来自真实 home 的 ~/.env.e2e.yaml（carriers.pi 声明 from: harness，
 * 可用 provider 字段选择借用目标），经 borrowChannel/borrowCredential 借用宿主登录态；
 * 沙盒内 models.json 由 piProfile 按借用渠道（harnessBaseUrl 原值 + 借用 token）生成。
 * 不变量：文件不进默认 runner；即使显式运行，也必须再通过单次授权值；
 * 会产生真实 token、费用与数据出站；诊断输出必须脱敏。
 */
import assert from "node:assert/strict";
import os from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  createHarnessLiveConfigHooks,
  createPtyAgentDriver,
} from "@x-agent-suite/harness";
import {
  LiveBackend,
  loadLiveConfig,
  redactLiveSecrets,
  resolveLiveChannel,
} from "@x-agent-suite/llm-fixture";
import { piProfile } from "../../packages/harness/tests/fixtures/profiles/pi.ts";

const AUTHORIZATION_ENV = "XAS_TUTORIAL_LIVE_AUTHORIZATION";
const AUTHORIZATION_VALUE = "I_ACCEPT_LIVE_COST_AND_DATA_EGRESS";
const authorized = process.env[AUTHORIZATION_ENV] === AUTHORIZATION_VALUE;

test(
  "Pi live PTY：真实 TUI 经借用的指定 provider 渠道完成一轮真实对话并清理",
  {
    skip: authorized
      ? false
      : `需要显式设置 ${AUTHORIZATION_ENV}=${AUTHORIZATION_VALUE}`,
    timeout: 180_000,
  },
  async (t) => {
    const homeDir = os.homedir();
    const hooks = createHarnessLiveConfigHooks();
    const loaded = await loadLiveConfig({ env: {}, homeDir, ...hooks });
    const resolved = resolveLiveChannel(loaded, "pi", {});
    if (resolved.kind !== "configured") {
      t.skip(
        resolved.kind === "not-configured"
          ? redactLiveSecrets(resolved.reason, [])
          : "carriers.pi 未配置",
      );
      return;
    }
    t.diagnostic(
      redactLiveSecrets(
        `channel: wire=${resolved.channel.wire} model=${resolved.channel.model} ` +
          `provider=${resolved.channel.provider ?? "-"} from=${resolved.channel.from ?? "-"}`,
        [resolved.channel],
      ),
    );

    const backend = new LiveBackend({
      carrier: "pi",
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
      // footer 显示沙盒 live 渠道注入的模型 id，证明 PTY 走的是声明的 provider/model
      assert.ok(
        driver.screenTail().includes(resolved.channel.model),
        `footer 未出现声明模型 ${resolved.channel.model}`,
      );
      const observation = await driver.sendPrompt("hi");
      assert.ok(
        observation.text.trim().length > 0,
        "真实 provider 未返回文本",
      );
      t.diagnostic(`reply length: ${observation.text.trim().length}`);
    } finally {
      await driver.close("Pi live PTY token test complete");
    }
  },
);
