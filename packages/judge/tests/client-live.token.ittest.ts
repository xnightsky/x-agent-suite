/**
 * @module @x-agent-suite/judge/tests/client-live
 * 真实 Pi + Kimi Coding 的纯文本 borrowed Judge token 验证。 // BOUNDARY-DEBT(judge-token): 仅真实宿主 token 测试；统一测试豁免后回收
 * 不变量：只经精确 ittest:token:judge 与本次批准值运行；单个 rubric、最多一次真实调用。
 * 会产生真实 token、费用与数据出站；配置、诊断和清理不得泄露秘密。
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { HarnessProfile } from "@x-agent-suite/contracts";
import {
  createHarnessDriver,
  createHarnessLiveConfigHooks,
  HarnessUnavailableError,
  resolveHarnessCommand,
} from "@x-agent-suite/harness";
import {
  createJudgeClient,
  judge,
  type BorrowedJudgeClientOptions,
} from "@x-agent-suite/judge";
import {
  LIVE_CONFIG_PATH_ENV,
  loadLiveConfig,
  loadTargetTagCatalog,
  redactLiveSecrets,
  resolveLiveTargets,
} from "@x-agent-suite/llm-fixture";
const { piProfile } = (await import(
  new URL("../../harness/tests/fixtures/profiles/pi.ts", import.meta.url).href // BOUNDARY-DEBT(judge-token): 仅真实宿主 token 测试；统一测试豁免后回收
)) as { piProfile: HarnessProfile };

const AUTHORIZATION_ENV = "XAS_JUDGE_LIVE_AUTHORIZATION";
const AUTHORIZATION_VALUE = "I_ACCEPT_LIVE_COST_AND_DATA_EGRESS";
const USAGE_ENV = "XAS_JUDGE_LIVE_USAGE";
const EXPECTED_USAGE = "third-party-subscription";
const authorized =
  process.env[AUTHORIZATION_ENV] === AUTHORIZATION_VALUE &&
  process.env[USAGE_ENV] === EXPECTED_USAGE;

const judgePiProfile: HarnessProfile = {
  ...piProfile,
  headlessArgs: (prompt) => [
    "--mode",
    "json",
    "--no-session",
    "--no-context-files",
    "--no-extensions",
    "--no-skills",
    "--no-tools",
    prompt,
  ],
  writeConfig: (sandbox, context) =>
    piProfile.writeConfig(sandbox, {
      ...context,
      injectServer: false,
      server: undefined,
    }),
};

/** 写入不含端点或凭据的临时声明；真实渠道只经现有 hooks 借用。 */
async function writeTemporaryConfig(path: string): Promise<void> {
  await writeFile(
    path,
    `carriers:
  pi: # BOUNDARY-DEBT(judge-token): 仅真实宿主测试配置；统一测试豁免后回收
    from: harness
    default: [kimi-for-coding] # BOUNDARY-DEBT(judge-token): 仅真实宿主测试配置；统一测试豁免后回收
    providers:
      kimi-coding: # BOUNDARY-DEBT(judge-token): 仅真实宿主测试配置；统一测试豁免后回收
        models: [kimi-for-coding] # BOUNDARY-DEBT(judge-token): 仅真实宿主测试配置；统一测试豁免后回收
targetTags:
  version: 1
  providers:
    - id: kimi-coding # BOUNDARY-DEBT(judge-token): 仅真实宿主测试配置；统一测试豁免后回收
      tags: [provider.usage.third-party-subscription, provider.usage.live.review-required]
`,
    "utf8",
  );
}

test(
  "Judge token：唯一 borrowed 候选完成单次真实 verdict 并清理",
  {
    skip: authorized
      ? false
      : `需要 ${AUTHORIZATION_ENV}=${AUTHORIZATION_VALUE} 且 ${USAGE_ENV}=${EXPECTED_USAGE}`,
    timeout: 120_000,
  },
  async (t) => {
    const root = await mkdtemp(join(os.tmpdir(), "xas-judge-token-"));
    const lifecycle: string[] = [];
    try {
      const configPath = join(root, "live.yaml");
      await writeTemporaryConfig(configPath);
      const homeDir = os.homedir();
      const hooks = createHarnessLiveConfigHooks();
      const config = { env: {}, homeDir, ...hooks };
      const loaded = await loadLiveConfig({
        ...config,
        env: { [LIVE_CONFIG_PATH_ENV]: configPath },
      });
      if (loaded.kind !== "loaded") {
        t.skip(redactLiveSecrets(loaded.reason, []));
        return;
      }
      const resolved = resolveLiveTargets(loaded, {
        carrier: "pi", // BOUNDARY-DEBT(judge-token): 仅真实宿主 token 测试；统一测试豁免后回收
        provider: "kimi-coding", // BOUNDARY-DEBT(judge-token): 仅真实宿主 token 测试；统一测试豁免后回收
        model: "kimi-for-coding", // BOUNDARY-DEBT(judge-token): 仅真实宿主 token 测试；统一测试豁免后回收
      });
      if (resolved.kind !== "configured") {
        t.skip(redactLiveSecrets(resolved.reason, []));
        return;
      }
      const target = resolved.targets[0]!;
      try {
        await resolveHarnessCommand({ name: judgePiProfile.command });
      } catch (error) {
        if (error instanceof HarnessUnavailableError) {
          t.skip(redactLiveSecrets(error.message, [target.channel]));
          return;
        }
        throw error;
      }

      t.diagnostic(
        `target provider=${target.channel.provider ?? "-"} model=${target.channel.model} wire=${target.channel.wire}`,
      );
      const tags = await loadTargetTagCatalog({ liveConfig: loaded });
      const createDriver: BorrowedJudgeClientOptions["createDriver"] = ({
        backend,
      }) => {
        const driver = createHarnessDriver(judgePiProfile, backend, {
          serverEntry: process.execPath,
          promptTimeoutMs: 60_000,
        });
        return {
          start: async () => {
            lifecycle.push("start");
            await driver.start();
          },
          sendPrompt: async (prompt) => {
            lifecycle.push("send");
            return driver.sendPrompt(prompt);
          },
          events: () => driver.events(),
          close: async (reason) => {
            lifecycle.push("close");
            await driver.close(reason);
          },
        };
      };
      const client = createJudgeClient({
        target,
        tags,
        config,
        toolPolicy: "none",
        liveReviewApproved: true,
        createDriver,
      });
      assert.equal(client.mode, "borrowed");
      assert.equal(client.cliRef, "pi"); // BOUNDARY-DEBT(judge-token): 仅真实宿主 token 测试；统一测试豁免后回收

      const outcome = await judge(
        {
          output: "标题：新增能力\n正文：补充实现与验证。",
          rubrics: [
            {
              name: "has_title_and_body",
              rubric:
                "输入是否同时包含“标题：”和“正文：”？只根据输入文本判断，必须返回 boolean。",
            },
          ],
        },
        { client, timeoutMs: 60_000, maxRetries: 0 },
      );
      t.diagnostic(
        redactLiveSecrets(
          `mode=${client.mode} cliRef=${client.cliRef} attempts=${outcome.attempts}`,
          [target.channel],
        ),
      );
      assert.equal(
        outcome.status,
        "completed",
        outcome.status === "not-evaluated"
          ? redactLiveSecrets(outcome.failure.message, [target.channel])
          : undefined,
      );
      assert.equal(outcome.attempts, 1);
      if (outcome.status === "completed") {
        assert.deepEqual(outcome.absent, []);
        assert.deepEqual(
          outcome.verdicts.map(({ name, pass }) => ({ name, pass })),
          [{ name: "has_title_and_body", pass: true }],
        );
      }
      assert.deepEqual(lifecycle, ["start", "send", "close"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
