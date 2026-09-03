/**
 * @module @x-agent-suite/llm-fixture/tests/live-config
 * 私密配置区（live-config）测试：加载顺序、缺文件/缺 carrier 的显式「未配置」结果、
 * apiKeyEnv 解析与 redactLiveSecrets 脱敏。
 * 不变量：全部在临时目录与注入 env 上运行，不读真实 home / 仓库配置，零网络。
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { stringify as stringifyYaml } from "yaml";
import {
  loadLiveConfig,
  redactLiveSecrets,
  resolveLiveApiKey,
  resolveLiveChannel,
  resolveLiveCredential,
  type LiveChannel,
} from "@x-agent-suite/llm-fixture";

/** 临时目录。 */
async function makeDirs(): Promise<{
  root: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(join(os.tmpdir(), "xas-live-config-"));
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

/** 写一份 YAML 配置文件（自动建父目录）。 */
async function writeConfig(
  path: string,
  carriers: Record<string, unknown>,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, stringifyYaml({ carriers }), "utf8");
}

const KIMI_CHANNEL = {
  wire: "openai-chat",
  baseUrl: "https://kimi-internal.example.com/v1",
  model: "kimi-k2",
  apiKeyEnv: "MOONSHOT_API_KEY",
};

test("无任何配置：load 与 resolve 均为显式「未配置」结果，不抛异常", async () => {
  const { root, cleanup } = await makeDirs();
  try {
    const load = await loadLiveConfig({
      env: {},
      repoRoot: join(root, "repo"),
      homeDir: join(root, "home"),
    });
    assert.equal(load.kind, "not-configured");
    const result = resolveLiveChannel(load, "kimi", {});
    assert.equal(result.kind, "not-configured");
    if (result.kind === "not-configured") {
      assert.ok(result.reason.length > 0, "未配置必须给出可读原因");
      assert.equal(result.carrier, "kimi");
    }
  } finally {
    await cleanup();
  }
});

test("home 配置文件命中：~/.config/x-agent-suite/.env.e2e.yaml", async () => {
  const { root, cleanup } = await makeDirs();
  try {
    const homeDir = join(root, "home");
    await writeConfig(
      join(homeDir, ".config", "x-agent-suite", ".env.e2e.yaml"),
      { kimi: KIMI_CHANNEL },
    );
    const load = await loadLiveConfig({
      env: {},
      repoRoot: join(root, "repo"),
      homeDir,
    });
    assert.equal(load.kind, "loaded");
    if (load.kind !== "loaded") return;
    assert.equal(load.source, "user-home");
    const result = resolveLiveChannel(load, "kimi", {});
    assert.equal(result.kind, "configured");
    if (result.kind !== "configured") return;
    assert.equal(result.channel.model, "kimi-k2");
    assert.equal(result.source, "user-home");
  } finally {
    await cleanup();
  }
});

test("加载顺序：env 字段覆盖 > E2E_LIVE_CONFIG_PATH > repo .env.e2e.yaml > home", async () => {
  const { root, cleanup } = await makeDirs();
  try {
    const repoRoot = join(root, "repo");
    const homeDir = join(root, "home");
    const explicitPath = join(root, "explicit.yaml");
    await writeConfig(
      join(homeDir, ".config", "x-agent-suite", ".env.e2e.yaml"),
      {
        kimi: { ...KIMI_CHANNEL, model: "home-model" },
      },
    );
    await writeConfig(join(repoRoot, ".env.e2e.yaml"), {
      kimi: { ...KIMI_CHANNEL, model: "repo-model" },
    });
    await writeConfig(explicitPath, {
      kimi: { ...KIMI_CHANNEL, model: "explicit-model" },
    });

    const homeOnly = await loadLiveConfig({
      env: {},
      repoRoot: join(root, "empty-repo"),
      homeDir,
    });
    assert.equal(resolveLiveChannel(homeOnly, "kimi", {}).kind, "configured");

    const repo = await loadLiveConfig({ env: {}, repoRoot, homeDir });
    if (repo.kind !== "loaded") assert.fail("repo 配置应命中");
    assert.equal(repo.source, "repo-local");
    const repoResult = resolveLiveChannel(repo, "kimi", {});
    if (repoResult.kind !== "configured") assert.fail("repo carrier 应已配置");
    assert.equal(repoResult.channel.model, "repo-model");

    const explicit = await loadLiveConfig({
      env: { E2E_LIVE_CONFIG_PATH: explicitPath },
      repoRoot,
      homeDir,
    });
    if (explicit.kind !== "loaded") assert.fail("显式路径配置应命中");
    assert.equal(explicit.source, "explicit-path");
    const explicitResult = resolveLiveChannel(explicit, "kimi", {});
    if (explicitResult.kind !== "configured")
      assert.fail("显式路径 carrier 应已配置");
    assert.equal(explicitResult.channel.model, "explicit-model");

    const envOverride = resolveLiveChannel(explicit, "kimi", {
      E2E_LIVE_KIMI_MODEL: "env-model",
      E2E_LIVE_KIMI_BASE_URL: "https://env-override.example.com/v1",
    });
    if (envOverride.kind !== "configured") assert.fail("env 覆盖后仍应已配置");
    assert.equal(envOverride.channel.model, "env-model");
    assert.equal(
      envOverride.channel.baseUrl,
      "https://env-override.example.com/v1",
    );
    assert.equal(envOverride.channel.apiKeyEnv, "MOONSHOT_API_KEY");
    assert.equal(envOverride.source, "env");
  } finally {
    await cleanup();
  }
});

test("纯 env 声明（无文件）→ configured，source 为 env；carrier 名含连字符归一为下划线", async () => {
  const load = await loadLiveConfig({
    env: {},
    repoRoot: "/nonexistent-repo",
    homeDir: "/nonexistent-home",
  });
  assert.equal(load.kind, "not-configured");
  const result = resolveLiveChannel(load, "my-carrier", {
    E2E_LIVE_MY_CARRIER_WIRE: "anthropic-messages",
    E2E_LIVE_MY_CARRIER_BASE_URL: "https://anthropic-internal.example.com/v1",
    E2E_LIVE_MY_CARRIER_MODEL: "claude-x",
    E2E_LIVE_MY_CARRIER_API_KEY: "sk-live-secret-value",
  });
  assert.equal(result.kind, "configured");
  if (result.kind !== "configured") return;
  assert.equal(result.source, "env");
  assert.equal(result.channel.wire, "anthropic-messages");
  assert.equal(resolveLiveApiKey(result.channel, {}), "sk-live-secret-value");
});

test("文件存在但未声明该 carrier / 声明缺字段 / wire 非法 → 显式「未配置」原因", async () => {
  const { root, cleanup } = await makeDirs();
  try {
    const repoRoot = join(root, "repo");
    await writeConfig(join(repoRoot, ".env.e2e.yaml"), {
      kimi: KIMI_CHANNEL,
      broken: { wire: "openai-chat", baseUrl: "https://x.example.com" },
      bogus: { ...KIMI_CHANNEL, wire: "not-a-wire" },
    });
    const load = await loadLiveConfig({
      env: {},
      repoRoot,
      homeDir: join(root, "home"),
    });
    assert.equal(load.kind, "loaded");

    const missing = resolveLiveChannel(load, "codex", {});
    assert.equal(missing.kind, "not-configured");
    if (missing.kind === "not-configured")
      assert.match(missing.reason, /codex/);

    const broken = resolveLiveChannel(load, "broken", {});
    assert.equal(broken.kind, "not-configured");
    if (broken.kind === "not-configured") assert.match(broken.reason, /model/);

    const bogus = resolveLiveChannel(load, "bogus", {});
    assert.equal(bogus.kind, "not-configured");
    if (bogus.kind === "not-configured") assert.match(bogus.reason, /wire/);
  } finally {
    await cleanup();
  }
});

test("借用凭据必须绑定 from: harness 且不能由 YAML 重定向端点", async () => {
  const { root, cleanup } = await makeDirs();
  try {
    const repoRoot = join(root, "repo");
    await writeConfig(join(repoRoot, ".env.e2e.yaml"), {
      detached: {
        wire: "openai-chat",
        baseUrl: "https://detached.example.com/v1",
        model: "m",
        credential: "harness",
      },
      badBase: {
        from: "harness",
        baseUrl: "https://redirect.example.com/v1",
      },
      badWire: { from: "harness", wire: "anthropic-messages" },
      badProvider: { from: "harness", provider: "redirect-provider" },
      conflictingCredential: {
        from: "harness",
        credential: "harness",
        apiKey: "synthetic-explicit-key",
      },
      direct: {
        from: "harness",
        baseUrl: "https://explicit.example.com/v1",
        apiKey: "synthetic-explicit-key",
      },
    });
    const load = await loadLiveConfig({
      env: {},
      repoRoot,
      homeDir: join(root, "home"),
      borrowChannel: async () => ({
        kind: "resolved",
        wire: "openai-chat",
        baseUrl: "https://borrowed.example.com/v1",
        model: "borrowed-model",
        provider: "borrowed-provider",
        source: "synthetic",
      }),
    });
    for (const carrier of [
      "detached",
      "badBase",
      "badWire",
      "badProvider",
      "conflictingCredential",
    ]) {
      const result = resolveLiveChannel(load, carrier, {});
      assert.equal(result.kind, "not-configured", carrier);
      if (result.kind === "not-configured") {
        assert.match(result.reason, /凭据|端点|from: harness/);
      }
    }
    const direct = resolveLiveChannel(load, "direct", {});
    assert.equal(direct.kind, "configured");
    if (direct.kind === "configured") {
      assert.equal(direct.channel.baseUrl, "https://explicit.example.com/v1");
      assert.equal(direct.channel.apiKey, "synthetic-explicit-key");
    }
  } finally {
    await cleanup();
  }
});

test("借用凭据不能由环境变量重定向端点或 wire", async () => {
  const { root, cleanup } = await makeDirs();
  try {
    const repoRoot = join(root, "repo");
    await writeConfig(join(repoRoot, ".env.e2e.yaml"), {
      borrowed: { from: "harness" },
    });
    const load = await loadLiveConfig({
      env: {},
      repoRoot,
      homeDir: join(root, "home"),
      borrowChannel: async () => ({
        kind: "resolved",
        wire: "openai-chat",
        baseUrl: "https://borrowed.example.com/v1",
        model: "borrowed-model",
        source: "synthetic",
      }),
    });
    for (const env of [
      { E2E_LIVE_BORROWED_BASE_URL: "https://redirect.example.com/v1" },
      { E2E_LIVE_BORROWED_WIRE: "anthropic-messages" },
      {
        E2E_LIVE_BORROWED_BASE_URL: "https://redirect.example.com/v1",
        E2E_LIVE_BORROWED_API_KEY_ENV: "MISSING_DIRECT_KEY",
      },
    ]) {
      const result = resolveLiveChannel(load, "borrowed", env);
      assert.equal(result.kind, "not-configured");
      if (result.kind === "not-configured") {
        assert.match(result.reason, /借用凭据|显式凭据/);
      }
    }
  } finally {
    await cleanup();
  }
});

test("resolveLiveApiKey：apiKey 字面量优先，其次 apiKeyEnv 指向的环境变量", async () => {
  const literal: LiveChannel = {
    wire: "openai-chat",
    baseUrl: "https://x.example.com/v1",
    model: "m",
    apiKey: "sk-literal",
  };
  assert.equal(resolveLiveApiKey(literal, {}), "sk-literal");
  const viaEnv: LiveChannel = {
    wire: "openai-chat",
    baseUrl: "https://x.example.com/v1",
    model: "m",
    apiKeyEnv: "MY_KEY",
  };
  assert.equal(
    resolveLiveApiKey(viaEnv, { MY_KEY: "sk-from-env" }),
    "sk-from-env",
  );
  assert.equal(resolveLiveApiKey(viaEnv, {}), undefined);
});

test("redactLiveSecrets：日志/报告文本中的 baseUrl 与 key 一律脱敏", () => {
  const channels: LiveChannel[] = [
    {
      wire: "openai-chat",
      baseUrl: "https://kimi-internal.example.com/v1",
      model: "kimi-k2",
      apiKey: "sk-super-secret",
    },
    {
      wire: "anthropic-messages",
      baseUrl: "https://claude-internal.example.com/v1",
      model: "claude-x",
    },
  ];
  const text =
    "请求 https://kimi-internal.example.com/v1/chat/completions 失败，" +
    "authorization=sk-super-secret；另一渠道 https://claude-internal.example.com/v1 正常";
  const redacted = redactLiveSecrets(text, channels);
  assert.ok(
    !redacted.includes("kimi-internal.example.com"),
    "baseUrl 主机不得残留",
  );
  assert.ok(!redacted.includes("sk-super-secret"), "apiKey 不得残留");
  assert.ok(
    !redacted.includes("claude-internal.example.com"),
    "第二渠道 baseUrl 同样脱敏",
  );
  assert.ok(redacted.includes("[REDACTED]"), "应留下脱敏占位符");
  assert.equal(redactLiveSecrets("无敏感信息", channels), "无敏感信息");
});

test("YAML 特性：注释与多行块标量被容忍", async () => {
  const { root, cleanup } = await makeDirs();
  try {
    const repoRoot = join(root, "repo");
    await mkdir(repoRoot, { recursive: true });
    await writeFile(
      join(repoRoot, ".env.e2e.yaml"),
      [
        "# 私密配置区：live 渠道声明",
        "carriers:",
        "  kimi:",
        "    wire: openai-chat",
        "    baseUrl: https://kimi-internal.example.com/v1  # 内网代理",
        "    model: kimi-k2",
        "    apiKeyEnv: MOONSHOT_API_KEY",
        "",
      ].join("\n"),
      "utf8",
    );
    const load = await loadLiveConfig({
      env: {},
      repoRoot,
      homeDir: join(root, "home"),
    });
    assert.equal(load.kind, "loaded");
    const result = resolveLiveChannel(load, "kimi", {});
    assert.equal(result.kind, "configured");
    if (result.kind !== "configured") return;
    assert.equal(
      result.channel.baseUrl,
      "https://kimi-internal.example.com/v1",
    );
    assert.equal(result.channel.apiKeyEnv, "MOONSHOT_API_KEY");
  } finally {
    await cleanup();
  }
});
