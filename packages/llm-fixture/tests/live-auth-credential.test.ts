/**
 * @module @x-agent-suite/llm-fixture/tests/live-auth-credential
 * 统一凭据来源选择、显式认证绑定与失败不回退测试。
 * 不变量：临时目录、合成 provider/secret、零网络、零 token。
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  LIVE_AUTH_CONFIG_PATH_ENV,
  LiveAuthConfigError,
  resolveLiveCredential,
  type LiveChannel,
} from "@x-agent-suite/llm-fixture";

function channel(overrides: Partial<LiveChannel> = {}): LiveChannel {
  return {
    wire: "openai-chat",
    baseUrl: "https://example.invalid/v1",
    model: "model-a",
    provider: "provider-a",
    ...overrides,
  };
}

async function authWorkspace(
  t: import("node:test").TestContext,
): Promise<string> {
  const root = await mkdtemp(join(os.tmpdir(), "xas-auth-credential-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function writeAuth(root: string, yaml: string): Promise<void> {
  await writeFile(join(root, ".env.auth.yaml"), yaml);
}

test("model-config 默认按 provider 使用 auth-file，并优先于内联凭据", async (t) => {
  const root = await authWorkspace(t);
  await writeAuth(
    root,
    "version: 1\nproviders:\n  provider-a:\n    type: api_key\n    apiKeyEnv: AUTH_FILE_KEY\n",
  );
  const result = await resolveLiveCredential(
    channel({ credentialSource: "model-config", apiKey: "inline-secret" }),
    {
      carrier: "carrier-a",
      repoRoot: root,
      homeDir: root,
      env: { AUTH_FILE_KEY: "auth-file-secret" },
    },
  );
  assert.equal(result.kind, "resolved");
  if (result.kind !== "resolved") return;
  assert.equal(result.apiKey, "auth-file-secret");
  assert.match(result.source, /auth file/);
});

test("默认认证条目不存在才回退内联凭据，大小写不匹配不算命中", async (t) => {
  const root = await authWorkspace(t);
  await writeAuth(
    root,
    "version: 1\nproviders:\n  Provider-A:\n    type: api_key\n    apiKey: wrong-secret\n",
  );
  const result = await resolveLiveCredential(
    channel({ credentialSource: "model-config", apiKey: "inline-secret" }),
    { carrier: "carrier-a", repoRoot: root, homeDir: root, env: {} },
  );
  assert.equal(result.kind, "resolved");
  if (result.kind !== "resolved") return;
  assert.equal(result.apiKey, "inline-secret");
});

test("runtime 来源不读取 auth 文件，缺值标记 required", async (t) => {
  const root = await authWorkspace(t);
  const missingPath = join(root, "missing-auth.yaml");
  const resolved = await resolveLiveCredential(
    channel({ credentialSource: "runtime", apiKeyEnv: "RUNTIME_KEY" }),
    {
      carrier: "carrier-a",
      repoRoot: root,
      homeDir: root,
      env: {
        RUNTIME_KEY: "runtime-secret",
        [LIVE_AUTH_CONFIG_PATH_ENV]: missingPath,
      },
    },
  );
  assert.equal(resolved.kind, "resolved");
  if (resolved.kind !== "resolved") return;
  assert.equal(resolved.apiKey, "runtime-secret");
  assert.match(resolved.source, /runtime/);

  const missing = await resolveLiveCredential(
    channel({ credentialSource: "runtime", apiKeyEnv: "MISSING_RUNTIME_KEY" }),
    {
      carrier: "carrier-a",
      repoRoot: root,
      homeDir: root,
      env: { [LIVE_AUTH_CONFIG_PATH_ENV]: missingPath },
    },
  );
  assert.equal(missing.kind, "missing");
  if (missing.kind !== "missing") return;
  assert.equal(missing.required, true);
});

test("auth.provider 允许多个渠道显式复用同一认证条目", async (t) => {
  const root = await authWorkspace(t);
  await writeAuth(
    root,
    "version: 1\nproviders:\n  shared-auth:\n    type: api_key\n    apiKey: shared-secret\n",
  );
  for (const provider of ["provider-a", "provider-b"]) {
    const result = await resolveLiveCredential(
      channel({
        provider,
        credentialSource: "model-config",
        auth: { provider: "shared-auth" },
      }),
      { carrier: "carrier-a", repoRoot: root, homeDir: root, env: {} },
    );
    assert.equal(result.kind, "resolved");
    if (result.kind !== "resolved") return;
    assert.equal(result.apiKey, "shared-secret");
  }
});

test("显式绑定缺文件或条目是配置错误，不回退内联凭据", async (t) => {
  const root = await authWorkspace(t);
  const bound = channel({
    credentialSource: "model-config",
    auth: { provider: "missing-auth" },
    apiKey: "must-not-fallback",
  });
  await assert.rejects(
    resolveLiveCredential(bound, {
      carrier: "carrier-a",
      repoRoot: root,
      homeDir: root,
      env: {},
    }),
    LiveAuthConfigError,
  );

  await writeAuth(root, "version: 1\nproviders: {}\n");
  await assert.rejects(
    resolveLiveCredential(bound, {
      carrier: "carrier-a",
      repoRoot: root,
      homeDir: root,
      env: {},
    }),
    LiveAuthConfigError,
  );
});

test("auth 条目环境变量缺值返回 required missing，不回退内联凭据", async (t) => {
  const root = await authWorkspace(t);
  await writeAuth(
    root,
    "version: 1\nproviders:\n  provider-a:\n    type: api_key\n    apiKeyEnv: MISSING_AUTH_KEY\n",
  );
  const result = await resolveLiveCredential(
    channel({ credentialSource: "model-config", apiKey: "must-not-fallback" }),
    { carrier: "carrier-a", repoRoot: root, homeDir: root, env: {} },
  );
  assert.equal(result.kind, "missing");
  if (result.kind !== "missing") return;
  assert.equal(result.required, true);
  assert.match(result.reason, /MISSING_AUTH_KEY/);
});

test("代码显式 channel 与无 provider ID 均不发现 auth 文件", async (t) => {
  const root = await authWorkspace(t);
  const env = { [LIVE_AUTH_CONFIG_PATH_ENV]: join(root, "missing-auth.yaml") };

  const explicit = await resolveLiveCredential(
    channel({ apiKey: "inline-secret" }),
    {
      carrier: "carrier-a",
      repoRoot: root,
      homeDir: root,
      env,
    },
  );
  assert.equal(explicit.kind, "resolved");
  if (explicit.kind !== "resolved") return;
  assert.equal(explicit.apiKey, "inline-secret");

  const noProvider = await resolveLiveCredential(
    channel({
      provider: undefined,
      credentialSource: "model-config",
      apiKey: "inline-secret",
    }),
    { carrier: "carrier-a", repoRoot: root, homeDir: root, env },
  );
  assert.equal(noProvider.kind, "resolved");
  if (noProvider.kind !== "resolved") return;
  assert.equal(noProvider.apiKey, "inline-secret");
});

test("损坏认证文件不得回退内联凭据", async (t) => {
  const root = await authWorkspace(t);
  await writeAuth(root, "version: 1\nproviders: [\n");
  await assert.rejects(
    resolveLiveCredential(
      channel({
        credentialSource: "model-config",
        apiKey: "must-not-fallback",
      }),
      { carrier: "carrier-a", repoRoot: root, homeDir: root, env: {} },
    ),
    LiveAuthConfigError,
  );
});

test("provider 查询只接受自有条目，不沿原型链误命中", async (t) => {
  const root = await authWorkspace(t);
  await writeAuth(root, "version: 1\nproviders: {}\n");
  for (const provider of ["constructor", "toString", "__proto__"]) {
    const fallback = await resolveLiveCredential(
      channel({
        provider,
        credentialSource: "model-config",
        apiKey: "inline-secret",
      }),
      { carrier: "carrier-a", repoRoot: root, homeDir: root, env: {} },
    );
    assert.equal(fallback.kind, "resolved");
    if (fallback.kind !== "resolved") return;
    assert.equal(fallback.apiKey, "inline-secret");

    await assert.rejects(
      resolveLiveCredential(
        channel({
          provider,
          credentialSource: "model-config",
          auth: { provider },
        }),
        { carrier: "carrier-a", repoRoot: root, homeDir: root, env: {} },
      ),
      LiveAuthConfigError,
    );
  }
});
