/**
 * @module @x-agent-suite/harness/tests/backend-context
 * startHarnessBackend 的 live 分支结构化判定回归。
 *
 * 不变量：live 判定只依赖契约品牌字段（mode + liveChannel），不依赖类身份——
 * 制品化分发下同一进程的 LiveBackend 类对象可能不止一个（bundle 内联、双包安装），
 * instanceof 跨制品恒 false 曾导致 liveEnv 静默失效。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  HarnessProfile,
  LlmBackend,
  LlmLiveChannel,
  SandboxContext,
} from "@x-agent-suite/contracts";

import { startHarnessBackend } from "../src/backend-context.ts";

const LIVE_CHANNEL: LlmLiveChannel = {
  wire: "smoke-wire",
  model: "smoke-model",
  baseUrl: "https://smoke.invalid/v1",
};

/**
 * 跨制品场景的同形 live backend：结构上与 LiveBackend 等价，
 * 但刻意不是任何 LiveBackend 类对象的实例（模拟 bundle 内联出的第二份类身份）。
 */
function makeCrossArtifactLiveBackend(): LlmBackend {
  return {
    mode: "live",
    liveChannel: LIVE_CHANNEL,
    start: () =>
      Promise.resolve({ baseUrl: LIVE_CHANNEL.baseUrl, apiKey: "smoke-key" }),
    stop: () => Promise.resolve(),
  };
}

function makeProfile(overrides: Partial<HarnessProfile> = {}): HarnessProfile {
  return {
    name: "generic",
    command: process.execPath,
    wire: "smoke-wire",
    headlessArgs: () => [],
    baseUrlEnv: "SMOKE_BASE_URL",
    apiKeyEnv: "SMOKE_API_KEY",
    stripEnv: [],
    toolName: (_server, tool) => tool,
    writeConfig: (_sandbox: SandboxContext) => Promise.resolve(),
    createParser: () => () => null,
    supportsFixture: true,
    ...overrides,
  };
}

test("startHarnessBackend：同形但非 LiveBackend 实例的 live backend 也走 live 分支", async () => {
  const liveEnvCalls: { channel: unknown; apiKey: string }[] = [];
  const profile = makeProfile({
    liveEnv: (context) => {
      liveEnvCalls.push(context);
      return { SMOKE_LIVE: "1", SMOKE_EMPTY: "" };
    },
  });

  const started = await startHarnessBackend(
    makeCrossArtifactLiveBackend(),
    profile,
  );

  assert.equal(liveEnvCalls.length, 1);
  assert.equal(liveEnvCalls[0]!.channel, LIVE_CHANNEL);
  assert.equal(liveEnvCalls[0]!.apiKey, "smoke-key");
  assert.deepEqual(started.liveChannel, LIVE_CHANNEL);
  assert.equal(started.env.SMOKE_LIVE, "1");
  // liveEnv 返回的空串值必须被丢弃。
  assert.equal("SMOKE_EMPTY" in started.env, false);
  // live 分支不注入 fixture 用的 baseUrlEnv / extraEnv。
  assert.equal("SMOKE_BASE_URL" in started.env, false);
});

test("startHarnessBackend：live backend 未暴露 liveChannel 时 liveEnv 不被调用", async () => {
  let liveEnvCalls = 0;
  const backend: LlmBackend = {
    mode: "live",
    start: () =>
      Promise.resolve({ baseUrl: "https://smoke.invalid/v1", apiKey: "k" }),
    stop: () => Promise.resolve(),
  };
  const started = await startHarnessBackend(
    backend,
    makeProfile({
      liveEnv: () => {
        liveEnvCalls += 1;
        return { SMOKE_LIVE: "1" };
      },
    }),
  );
  assert.equal(liveEnvCalls, 0);
  assert.equal(started.liveChannel, undefined);
  assert.deepEqual(started.env, {});
});

test("startHarnessBackend：fixture 分支注入 baseUrlEnv/apiKeyEnv/extraEnv", async () => {
  const backend: LlmBackend = {
    mode: "fixture",
    start: () =>
      Promise.resolve({ baseUrl: "http://127.0.0.1:1", apiKey: "fake" }),
    stop: () => Promise.resolve(),
  };
  const started = await startHarnessBackend(
    backend,
    makeProfile({ extraEnv: { SMOKE_EXTRA: "x" } }),
  );
  assert.equal(started.liveChannel, undefined);
  assert.deepEqual(started.env, {
    SMOKE_EXTRA: "x",
    SMOKE_BASE_URL: "http://127.0.0.1:1",
    SMOKE_API_KEY: "fake",
  });
});
