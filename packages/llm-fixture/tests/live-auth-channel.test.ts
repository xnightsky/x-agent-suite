/**
 * @module @x-agent-suite/llm-fixture/tests/live-auth-channel
 * 模型渠道认证绑定、互斥校验与凭据来源标记测试。
 * 不变量：临时目录、合成渠道、零网络、零 token。
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  loadLiveConfig,
  resolveLiveChannel,
  resolveLiveTargets,
  type LiveConfigOptions,
} from "@x-agent-suite/llm-fixture";

async function loadYaml(
  t: import("node:test").TestContext,
  yaml: string,
  options: Partial<LiveConfigOptions> = {},
) {
  const repoRoot = await mkdtemp(join(os.tmpdir(), "xas-auth-channel-"));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  await writeFile(join(repoRoot, ".env.e2e.yaml"), yaml);
  return loadLiveConfig({
    repoRoot,
    homeDir: repoRoot,
    env: {},
    ...options,
  });
}

test("provider 的 auth.provider 在默认 target 展开后保留", async (t) => {
  const load = await loadYaml(
    t,
    `carriers:
  carrier-a:
    default: [model-a]
    providers:
      provider-a:
        auth:
          provider: shared-auth
        baseUrl: https://example.invalid/v1
        wire: openai-chat
        models: [model-a]
`,
  );
  assert.equal(load.kind, "loaded");
  if (load.kind !== "loaded") return;
  assert.deepEqual(load.invalid, {});

  const result = resolveLiveTargets(load, { carrier: "carrier-a" });
  assert.equal(result.kind, "configured");
  if (result.kind !== "configured") return;
  assert.equal(result.targets.length, 1);
  assert.deepEqual(result.targets[0]?.channel.auth, {
    provider: "shared-auth",
  });
});

test("auth 绑定与内联凭据或未知字段互斥", async (t) => {
  const declarations = [
    "auth: { provider: '' }",
    "auth: { provider: shared, extra: true }",
    "auth: { provider: shared }\n        apiKey: inline",
    "auth: { provider: shared }\n        apiKeyEnv: INLINE_KEY",
    "auth: { provider: shared }\n        credential: harness",
    "auth: { provider: shared }\n        apiKey: null",
    "auth: { provider: shared }\n        apiKey: 123",
    "auth: { provider: shared }\n        apiKeyEnv: null",
  ];
  for (const [index, declaration] of declarations.entries()) {
    await t.test(`非法绑定 ${index + 1}`, async () => {
      const load = await loadYaml(
        t,
        `carriers:
  carrier-a:
    default: [model-a]
    providers:
      provider-a:
        ${declaration}
        baseUrl: https://example.invalid/v1
        wire: openai-chat
        models: [model-a]
`,
      );
      assert.equal(load.kind, "loaded");
      if (load.kind !== "loaded") return;
      assert.equal(typeof load.invalid["carrier-a"], "string");
    });
  }
});

test("from:harness 仅在未显式绑定 auth 时隐含借用凭据", async (t) => {
  const borrowChannel: NonNullable<LiveConfigOptions["borrowChannel"]> = () =>
    Promise.resolve({
      kind: "resolved",
      wire: "openai-chat",
      baseUrl: "https://example.invalid/v1",
      provider: "provider-a",
      model: "model-a",
      source: "synthetic",
    });
  const bound = await loadYaml(
    t,
    `carriers:
  carrier-a:
    from: harness
    auth:
      provider: shared-auth
`,
    { borrowChannel },
  );
  assert.equal(bound.kind, "loaded");
  if (bound.kind !== "loaded") return;
  assert.deepEqual(bound.channels["carrier-a"]?.auth, {
    provider: "shared-auth",
  });
  assert.equal(bound.channels["carrier-a"]?.credential, undefined);

  const borrowed = await loadYaml(
    t,
    `carriers:
  carrier-b:
    from: harness
`,
    { borrowChannel },
  );
  assert.equal(borrowed.kind, "loaded");
  if (borrowed.kind !== "loaded") return;
  assert.equal(borrowed.channels["carrier-b"]?.credential, "harness");
});

test("文件渠道与运行时凭据覆盖保留不同 credentialSource", async (t) => {
  const load = await loadYaml(
    t,
    `carriers:
  carrier-a:
    provider: provider-a
    model: model-a
    baseUrl: https://example.invalid/v1
    wire: openai-chat
`,
  );
  const fromFile = resolveLiveChannel(load, "carrier-a", {});
  assert.equal(fromFile.kind, "configured");
  if (fromFile.kind !== "configured") return;
  assert.equal(fromFile.channel.credentialSource, "model-config");

  const fromRuntime = resolveLiveChannel(load, "carrier-a", {
    E2E_LIVE_CARRIER_A_API_KEY: "runtime-secret",
  });
  assert.equal(fromRuntime.kind, "configured");
  if (fromRuntime.kind !== "configured") return;
  assert.equal(fromRuntime.channel.credentialSource, "runtime");

  const modelOverride = resolveLiveChannel(load, "carrier-a", {
    E2E_LIVE_CARRIER_A_MODEL: "other-model",
  });
  assert.equal(modelOverride.kind, "configured");
  if (modelOverride.kind !== "configured") return;
  assert.equal(modelOverride.channel.credentialSource, "model-config");
});

test("runtime 凭据覆盖替换模型层认证意图而不是叠加冲突", async (t) => {
  const cases = [
    {
      declaration: "auth: { provider: shared-auth }",
      env: { E2E_LIVE_CARRIER_A_API_KEY: "runtime-secret" },
      field: "apiKey" as const,
    },
    {
      declaration: "apiKey: inline-secret",
      env: { E2E_LIVE_CARRIER_A_API_KEY_ENV: "RUNTIME_KEY" },
      field: "apiKeyEnv" as const,
    },
    {
      declaration: "apiKeyEnv: INLINE_KEY",
      env: { E2E_LIVE_CARRIER_A_API_KEY: "runtime-secret" },
      field: "apiKey" as const,
    },
  ];
  for (const [index, item] of cases.entries()) {
    await t.test(`覆盖组合 ${index + 1}`, async () => {
      const load = await loadYaml(
        t,
        `carriers:
  carrier-a:
    provider: provider-a
    model: model-a
    ${item.declaration}
    baseUrl: https://example.invalid/v1
    wire: openai-chat
`,
      );
      const result = resolveLiveChannel(load, "carrier-a", item.env);
      assert.equal(result.kind, "configured", JSON.stringify(result));
      if (result.kind !== "configured") return;
      assert.equal(result.channel.credentialSource, "runtime");
      assert.equal(result.channel.auth, undefined);
      assert.equal(
        result.channel[item.field],
        item.field === "apiKey" ? "runtime-secret" : "RUNTIME_KEY",
      );
      const other = item.field === "apiKey" ? "apiKeyEnv" : "apiKey";
      assert.equal(result.channel[other], undefined);
    });
  }
});

test("空字符串 runtime 覆盖仍保留 runtime 来源且替换内联凭据", async (t) => {
  const load = await loadYaml(
    t,
    `carriers:
  carrier-a:
    provider: provider-a
    model: model-a
    apiKey: inline-secret
    baseUrl: https://example.invalid/v1
    wire: openai-chat
`,
  );
  for (const field of ["API_KEY", "API_KEY_ENV"] as const) {
    const result = resolveLiveChannel(load, "carrier-a", {
      [`E2E_LIVE_CARRIER_A_${field}`]: "",
    });
    assert.equal(result.kind, "configured", JSON.stringify(result));
    if (result.kind !== "configured") return;
    assert.equal(result.channel.credentialSource, "runtime");
    assert.equal(result.channel.apiKey, field === "API_KEY" ? "" : undefined);
    assert.equal(
      result.channel.apiKeyEnv,
      field === "API_KEY_ENV" ? "" : undefined,
    );
  }
});
