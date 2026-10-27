/**
 * @module examples/tutorial/10-live-smoke
 * 真实 provider 的最小 tool-calling 嗅探示例，会产生真实 token、费用与数据出站。
 * 不变量：文件不进默认 runner；即使显式运行，也必须再通过单次授权值。
 */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  loadLiveConfig,
  redactLiveSecrets,
  resolveLiveTargets,
  sniffLiveChannel,
} from "@x-agent-suite/llm-fixture";
import { cleanupSandbox, createSandbox } from "@x-agent-suite/sandbox";

const ROOT = resolve(import.meta.dirname, "../..");
const AUTHORIZATION_ENV = "XAS_TUTORIAL_LIVE_AUTHORIZATION";
const AUTHORIZATION_VALUE = "I_ACCEPT_LIVE_COST_AND_DATA_EGRESS";
const CARRIER_ENV = "XAS_TUTORIAL_LIVE_CARRIER";
const authorized = process.env[AUTHORIZATION_ENV] === AUTHORIZATION_VALUE;

test(
  "live smoke：默认 target 完成最小 tool-calling 嗅探",
  {
    skip: authorized
      ? false
      : `需要显式设置 ${AUTHORIZATION_ENV}=${AUTHORIZATION_VALUE}`,
  },
  async (t) => {
    const carrier = process.env[CARRIER_ENV];
    if (!carrier) {
      t.skip(`未设置 ${CARRIER_ENV}`);
      return;
    }

    const sandbox = await createSandbox();
    try {
      const loaded = await loadLiveConfig({
        env: {},
        repoRoot: ROOT,
        homeDir: sandbox.homeDir,
      });
      if (loaded.kind === "loaded") {
        for (const warning of loaded.warnings) {
          t.diagnostic(`[${warning.code}] ${warning.message}`);
        }
      }
      const resolved = resolveLiveTargets(loaded, { carrier });
      if (resolved.kind === "not-configured") {
        t.skip(redactLiveSecrets(resolved.reason, []));
        return;
      }

      for (const target of resolved.targets) {
        const { channel } = target;
        const name = `${channel.provider ?? "-"}/${channel.model}`;
        await t.test(name, { timeout: 30_000 }, async (subtest) => {
          const result = await sniffLiveChannel(carrier, channel, {
            timeoutMs: 20_000,
          });
          assert.equal(
            result.ok,
            true,
            result.ok
              ? undefined
              : redactLiveSecrets(`${result.stage}: ${result.reason}`, [
                  channel,
                ]),
          );
          subtest.diagnostic(
            JSON.stringify({
              carrier: result.carrier,
              provider: channel.provider,
              model: channel.model,
              latencyMs: result.ok ? result.latencyMs : undefined,
              modelReported: result.ok ? result.modelReported : undefined,
            }),
          );
        });
      }
    } finally {
      await cleanupSandbox(sandbox);
    }
  },
);
