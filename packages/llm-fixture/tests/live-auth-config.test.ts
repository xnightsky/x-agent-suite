/**
 * @module @x-agent-suite/llm-fixture/tests/live-auth-config
 * 可选认证文件的严格 schema、发现顺序与安全错误测试。
 * 不变量：只使用临时目录和合成 secret，不读取真实 home，不发起网络请求。
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  LIVE_AUTH_CONFIG_PATH_ENV,
  LiveAuthConfigError,
  loadLiveAuthConfig,
  parseLiveAuthConfig,
} from "@x-agent-suite/llm-fixture";

async function workspace(t: import("node:test").TestContext): Promise<{
  readonly root: string;
  readonly home: string;
}> {
  const root = await mkdtemp(join(os.tmpdir(), "xas-auth-repo-"));
  const home = await mkdtemp(join(os.tmpdir(), "xas-auth-home-"));
  t.after(async () => {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(home, { recursive: true, force: true }),
    ]);
  });
  return { root, home };
}

test("认证文件接受环境变量引用与字面量两种 API key", () => {
  const config = parseLiveAuthConfig(`version: 1
providers:
  provider-a:
    type: api_key
    apiKeyEnv: PROVIDER_A_API_KEY
  provider-b:
    type: api_key
    apiKey: synthetic-literal
`);

  assert.deepEqual(config, {
    version: 1,
    providers: {
      "provider-a": { type: "api_key", apiKeyEnv: "PROVIDER_A_API_KEY" },
      "provider-b": { type: "api_key", apiKey: "synthetic-literal" },
    },
  });
});

test("认证文件拒绝非法结构和含混凭据声明", async (t) => {
  const invalid = [
    "version: 2\nproviders: {}",
    "version: 1\nproviders: []\n",
    "version: 1\nproviders:\n  p:\n    type: oauth\n    apiKey: x\n",
    "version: 1\nproviders:\n  p:\n    type: api_key\n",
    "version: 1\nproviders:\n  p:\n    type: api_key\n    apiKey: x\n    apiKeyEnv: X\n",
    "version: 1\nproviders:\n  p:\n    type: api_key\n    apiKey: ''\n",
    "version: 1\nproviders:\n  '':\n    type: api_key\n    apiKey: x\n",
    "version: 1\nproviders:\n  p:\n    type: api_key\n    apiKey: x\n    baseUrl: https://example.invalid\n",
    "version: 1\nproviders: {}\nextra: true\n",
  ];
  for (const [index, text] of invalid.entries()) {
    await t.test(`非法样例 ${index + 1}`, () => {
      assert.throws(() => parseLiveAuthConfig(text), LiveAuthConfigError);
    });
  }
});

test("认证文件拒绝重复 YAML key", () => {
  assert.throws(
    () =>
      parseLiveAuthConfig(`version: 1
providers:
  provider-a:
    type: api_key
    apiKey: first
    apiKey: second
`),
    LiveAuthConfigError,
  );
});

test("认证文件发现遵循 explicit > repo > home 且命中即停", async (t) => {
  const { root, home } = await workspace(t);
  const explicit = join(root, "explicit.yaml");
  await writeFile(
    join(root, ".env.auth.yaml"),
    "version: 1\nproviders:\n  p:\n    type: api_key\n    apiKey: repo\n",
  );
  await writeFile(
    join(home, ".env.auth.yaml"),
    "version: 1\nproviders:\n  p:\n    type: api_key\n    apiKey: home\n",
  );
  await writeFile(
    explicit,
    "version: 1\nproviders:\n  p:\n    type: api_key\n    apiKey: explicit\n",
  );

  const repo = await loadLiveAuthConfig({
    repoRoot: root,
    homeDir: home,
    env: {},
  });
  assert.equal(repo.kind, "loaded");
  if (repo.kind === "loaded") {
    assert.equal(repo.source, "repo-local");
    assert.equal(repo.config.providers.p?.apiKey, "repo");
  }

  const selected = await loadLiveAuthConfig({
    repoRoot: root,
    homeDir: home,
    env: { [LIVE_AUTH_CONFIG_PATH_ENV]: explicit },
  });
  assert.equal(selected.kind, "loaded");
  if (selected.kind === "loaded") {
    assert.equal(selected.source, "explicit-path");
    assert.equal(selected.config.providers.p?.apiKey, "explicit");
  }
});

test("repo 缺失时使用 home；全部缺失表示未配置", async (t) => {
  const { root, home } = await workspace(t);
  await writeFile(
    join(home, ".env.auth.yaml"),
    "version: 1\nproviders:\n  p:\n    type: api_key\n    apiKey: home\n",
  );
  const loaded = await loadLiveAuthConfig({
    repoRoot: root,
    homeDir: home,
    env: {},
  });
  assert.equal(loaded.kind, "loaded");
  if (loaded.kind === "loaded") assert.equal(loaded.source, "home-dot");

  const missingRoot = await mkdtemp(join(os.tmpdir(), "xas-auth-empty-"));
  t.after(() => rm(missingRoot, { recursive: true, force: true }));
  const missing = await loadLiveAuthConfig({
    repoRoot: missingRoot,
    homeDir: missingRoot,
    env: {},
  });
  assert.deepEqual(missing, { kind: "not-configured" });
});

test("显式文件缺失与默认路径不可读均显式报错", async (t) => {
  const { root, home } = await workspace(t);
  await assert.rejects(
    loadLiveAuthConfig({
      repoRoot: root,
      homeDir: home,
      env: { [LIVE_AUTH_CONFIG_PATH_ENV]: join(root, "missing.yaml") },
    }),
    LiveAuthConfigError,
  );

  const fileRoot = join(root, "not-a-directory");
  await writeFile(fileRoot, "x");
  await assert.rejects(
    loadLiveAuthConfig({ repoRoot: fileRoot, homeDir: home, env: {} }),
    LiveAuthConfigError,
  );
});

test("YAML 与 schema 错误不回显 secret 或原始配置行", async (t) => {
  const { root, home } = await workspace(t);
  const secret = "synthetic-auth-secret-do-not-leak";
  await writeFile(
    join(root, ".env.auth.yaml"),
    `version: 1\nproviders:\n  p:\n    type: api_key\n    apiKey: "${secret}"\n    broken: [\n`,
  );
  await assert.rejects(
    loadLiveAuthConfig({ repoRoot: root, homeDir: home, env: {} }),
    (error: unknown) => {
      assert.ok(error instanceof LiveAuthConfigError);
      assert.doesNotMatch(error.message, new RegExp(secret));
      assert.doesNotMatch(error.message, /broken:/);
      return true;
    },
  );

  assert.throws(
    () =>
      parseLiveAuthConfig(`version: 1
providers:
  p:
    type: api_key
    apiKey: ${secret}
    apiKeyEnv: OTHER_SECRET
`),
    (error: unknown) => {
      assert.ok(error instanceof LiveAuthConfigError);
      assert.doesNotMatch(error.message, new RegExp(secret));
      assert.doesNotMatch(error.message, /OTHER_SECRET/);
      return true;
    },
  );
});
