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
  resolveLiveChannel,
  sniffLiveChannel,
} from "@x-agent-suite/llm-fixture";
import { cleanupSandbox, createSandbox } from "@x-agent-suite/sandbox";

const ROOT = resolve(import.meta.dirname, "../..");
const AUTHORIZATION_ENV = "XAS_TUTORIAL_LIVE_AUTHORIZATION";
const AUTHORIZATION_VALUE = "I_ACCEPT_LIVE_COST_AND_DATA_EGRESS";
const CARRIER_ENV = "XAS_TUTORIAL_LIVE_CARRIER";
const authorized = process.env[AUTHORIZATION_ENV] === AUTHORIZATION_VALUE;

test(
  "live smoke：真实渠道完成一次最小 tool-calling 嗅探",
  {
    skip: authorized
      ? false
      : `需要显式设置 ${AUTHORIZATION_ENV}=${AUTHORIZATION_VALUE}`,
    timeout: 30_000,
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
      const resolved = resolveLiveChannel(loaded, carrier, {});
      if (resolved.kind === "not-configured") {
        t.skip(redactLiveSecrets(resolved.reason, []));
        return;
      }

      const result = await sniffLiveChannel(carrier, resolved.channel, {
        timeoutMs: 20_000,
      });
      assert.equal(
        result.ok,
        true,
        result.ok
          ? undefined
          : redactLiveSecrets(`${result.stage}: ${result.reason}`, [
              resolved.channel,
            ]),
      );
      t.diagnostic(
        JSON.stringify({
          carrier: result.carrier,
          latencyMs: result.ok ? result.latencyMs : undefined,
          modelReported: result.ok ? result.modelReported : undefined,
        }),
      );
    } finally {
      await cleanupSandbox(sandbox);
    }
  },
);
