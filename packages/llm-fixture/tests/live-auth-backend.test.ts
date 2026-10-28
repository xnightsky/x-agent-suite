/**
 * @module @x-agent-suite/llm-fixture/tests/live-auth-backend
 * LiveBackend 对可选认证文件、运行时覆盖与脱敏的集成测试。
 * 不变量：临时目录、合成 secret、注入 transport、零真实请求。
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { inspect } from "node:util";
import {
  LiveBackend,
  LiveNotConfiguredError,
  type LiveTransport,
} from "@x-agent-suite/llm-fixture";

async function workspace(t: import("node:test").TestContext): Promise<string> {
  const root = await mkdtemp(join(os.tmpdir(), "xas-auth-backend-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, ".env.e2e.yaml"),
    `carriers:
  carrier-a:
    provider: provider-a
    model: model-a
    baseUrl: https://example.invalid/v1
    wire: openai-chat
`,
  );
  return root;
}

async function writeAuth(root: string, yaml: string): Promise<void> {
  await writeFile(join(root, ".env.auth.yaml"), yaml);
}

test("LiveBackend 从匹配 provider 的 auth 文件解析 key", async (t) => {
  const root = await workspace(t);
  await writeAuth(
    root,
    "version: 1\nproviders:\n  provider-a:\n    type: api_key\n    apiKeyEnv: AUTH_FILE_KEY\n",
  );
  const backend = new LiveBackend({
    carrier: "carrier-a",
    config: {
      repoRoot: root,
      homeDir: root,
      env: { AUTH_FILE_KEY: "auth-file-secret" },
    },
  });
  const started = await backend.start();
  assert.equal(started.apiKey, "auth-file-secret");
});

test("LiveBackend 的 runtime 凭据覆盖优先于 auth 文件", async (t) => {
  const root = await workspace(t);
  await writeAuth(
    root,
    "version: 1\nproviders:\n  provider-a:\n    type: api_key\n    apiKey: auth-file-secret\n",
  );
  const backend = new LiveBackend({
    carrier: "carrier-a",
    config: {
      repoRoot: root,
      homeDir: root,
      env: { E2E_LIVE_CARRIER_A_API_KEY: "runtime-secret" },
    },
  });
  const started = await backend.start();
  assert.equal(started.apiKey, "runtime-secret");
});

test("代码显式 channel 不读取认证文件", async (t) => {
  const root = await workspace(t);
  const backend = new LiveBackend({
    carrier: "carrier-a",
    channel: {
      wire: "openai-chat",
      baseUrl: "https://example.invalid/v1",
      model: "model-a",
      provider: "provider-a",
      apiKey: "inline-secret",
    },
    config: {
      repoRoot: root,
      homeDir: root,
      env: { E2E_AUTH_CONFIG_PATH: join(root, "missing-auth.yaml") },
    },
  });
  const started = await backend.start();
  assert.equal(started.apiKey, "inline-secret");
});

test("runtime 与 auth-file 已选来源缺值时 start 显式失败", async (t) => {
  const root = await workspace(t);
  const runtime = new LiveBackend({
    carrier: "carrier-a",
    config: {
      repoRoot: root,
      homeDir: root,
      env: { E2E_LIVE_CARRIER_A_API_KEY_ENV: "MISSING_RUNTIME_KEY" },
    },
  });
  await assert.rejects(runtime.start(), LiveNotConfiguredError);

  await writeAuth(
    root,
    "version: 1\nproviders:\n  provider-a:\n    type: api_key\n    apiKeyEnv: MISSING_AUTH_KEY\n",
  );
  const fromAuth = new LiveBackend({
    carrier: "carrier-a",
    config: { repoRoot: root, homeDir: root, env: {} },
  });
  await assert.rejects(fromAuth.start(), LiveNotConfiguredError);
});

test("auth 字面量在嵌套 transport 异常中完整脱敏", async (t) => {
  const root = await workspace(t);
  const secret = "synthetic-auth-backend-secret";
  await writeAuth(
    root,
    `version: 1\nproviders:\n  provider-a:\n    type: api_key\n    apiKey: ${secret}\n`,
  );
  const transport: LiveTransport = async () => {
    throw new AggregateError(
      [new Error(`nested=${secret}`)],
      `transport=${secret}`,
      { cause: new Error(`cause=${secret}`) },
    );
  };
  const backend = new LiveBackend({
    carrier: "carrier-a",
    transport,
    config: { repoRoot: root, homeDir: root, env: {} },
  });
  await backend.start();
  await assert.rejects(
    backend.complete({ messages: [{ role: "user", text: "hello" }] }),
    (error: unknown) => {
      const diagnostic = inspect(error, { depth: 10 });
      assert.doesNotMatch(diagnostic, new RegExp(secret));
      assert.match(diagnostic, /\[REDACTED\]/);
      return true;
    },
  );
});

test("backend runtime 覆盖与模型层认证声明组合时不冲突", async (t) => {
  const cases = [
    {
      declaration: "auth: { provider: shared-auth }",
      env: { E2E_LIVE_CARRIER_A_API_KEY: "runtime-secret" },
    },
    {
      declaration: "apiKey: inline-secret",
      env: { E2E_LIVE_CARRIER_A_API_KEY_ENV: "RUNTIME_KEY" },
    },
    {
      declaration: "apiKeyEnv: INLINE_KEY",
      env: { E2E_LIVE_CARRIER_A_API_KEY: "runtime-secret" },
    },
  ];
  for (const [index, item] of cases.entries()) {
    await t.test(`backend 覆盖组合 ${index + 1}`, async () => {
      const root = await workspace(t);
      await writeFile(
        join(root, ".env.e2e.yaml"),
        `carriers:\n  carrier-a:\n    provider: provider-a\n    model: model-a\n    ${item.declaration}\n    baseUrl: https://example.invalid/v1\n    wire: openai-chat\n`,
      );
      await writeAuth(
        root,
        "version: 1\nproviders:\n  provider-a:\n    type: api_key\n    apiKey: must-not-win\n",
      );
      const backend = new LiveBackend({
        carrier: "carrier-a",
        config: {
          repoRoot: root,
          homeDir: root,
          env: { ...item.env, RUNTIME_KEY: "runtime-secret" },
        },
      });
      const started = await backend.start();
      assert.equal(started.apiKey, "runtime-secret");
    });
  }
});
