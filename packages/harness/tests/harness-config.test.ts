/**
 * @module @x-agent-suite/harness/tests/harness-config
 * harness 渠道借用测试：baseUrl/wire/model 直接取宿主 CLI 自己的配置。
 * 不变量：全部指向临时目录里的假配置文件，不读真实 home，零网络。
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadLiveConfig, resolveLiveChannel } from "@x-agent-suite/llm-fixture";
import { createHarnessLiveConfigHooks } from "@x-agent-suite/harness";
import { resolveHarnessChannel } from "../src/harness-config.ts";

async function makeHome(): Promise<{
  home: string;
  cleanup: () => Promise<void>;
}> {
  const home = await mkdtemp(join(os.tmpdir(), "xas-hchan-"));
  return { home, cleanup: () => rm(home, { recursive: true, force: true }) };
}

async function write(
  home: string,
  rel: string,
  content: string,
): Promise<void> {
  const p = join(home, rel);
  await mkdir(join(p, ".."), { recursive: true });
  await writeFile(p, content, "utf8");
}

test("宿主 A：default_model 拆 provider/model，provider 段取 base_url，type kimi → openai-chat", async () => {
  const { home, cleanup } = await makeHome();
  try {
    await write(
      home,
      ".kimi-code/config.toml",
      [
        'default_model = "kimi-code/k3-256k"',
        "[providers.deepseek]",
        'type = "openai"',
        'base_url = "https://api.deepseek.com"',
        '[providers."managed:kimi-code"]',
        'type = "kimi"',
        'base_url = "https://api.kimi.com/coding/v1"',
        '[models."kimi-code/k3-256k"]',
        'provider = "managed:kimi-code"',
        'model = "k3-256k"',
        "",
      ].join("\n"),
    );
    const r = await resolveHarnessChannel("kimi", { homeDir: home });
    assert.equal(r.kind, "resolved");
    if (r.kind !== "resolved") return;
    assert.equal(r.channel.wire, "openai-chat");
    assert.equal(r.channel.baseUrl, "https://api.kimi.com/coding/v1");
    assert.equal(r.channel.model, "k3-256k");
  } finally {
    await cleanup();
  }
});

test("宿主 A：缺 default_model 或 provider 段 → missing 且说明缺什么", async () => {
  const { home, cleanup } = await makeHome();
  try {
    const noFile = await resolveHarnessChannel("kimi", { homeDir: home });
    assert.equal(noFile.kind, "missing");
    if (noFile.kind !== "missing") return;
    assert.match(noFile.reason, /config\.toml/);

    await write(
      home,
      ".kimi-code/config.toml",
      'default_model = "kimi-code/k3-256k"\n',
    );
    const noProvider = await resolveHarnessChannel("kimi", { homeDir: home });
    assert.equal(noProvider.kind, "missing");
    if (noProvider.kind !== "missing") return;
    assert.match(noProvider.reason, /provider/);
  } finally {
    await cleanup();
  }
});

test("宿主 B：无自定义 provider → 默认 OpenAI 端点；有 model_provider → 取其 base_url", async () => {
  const { home, cleanup } = await makeHome();
  try {
    await write(home, ".codex/config.toml", 'model = "gpt-5.6-sol"\n');
    const def = await resolveHarnessChannel("codex", { homeDir: home });
    assert.equal(def.kind, "resolved");
    if (def.kind !== "resolved") return;
    assert.equal(def.channel.wire, "openai-responses");
    assert.equal(def.channel.baseUrl, "https://api.openai.com/v1");
    assert.equal(def.channel.model, "gpt-5.6-sol");

    await write(
      home,
      ".codex/config.toml",
      [
        'model = "gpt-x"',
        'model_provider = "relay"',
        "[model_providers.relay]",
        'name = "relay"',
        'base_url = "https://relay.example.com/v1"',
        'wire_api = "responses"',
        "",
      ].join("\n"),
    );
    const custom = await resolveHarnessChannel("codex", { homeDir: home });
    assert.equal(custom.kind, "resolved");
    if (custom.kind !== "resolved") return;
    assert.equal(custom.channel.baseUrl, "https://relay.example.com/v1");
    assert.equal(custom.channel.model, "gpt-x");
  } finally {
    await cleanup();
  }
});

test("宿主 C：settings model + ANTHROPIC_BASE_URL；无 env 时用官方端点", async () => {
  const { home, cleanup } = await makeHome();
  try {
    await write(
      home,
      ".claude/settings.json",
      JSON.stringify({
        model: "opus[1m]",
        env: { ANTHROPIC_BASE_URL: "https://relay.invalid" },
      }),
    );
    const r = await resolveHarnessChannel("claude", { homeDir: home });
    assert.equal(r.kind, "resolved");
    if (r.kind !== "resolved") return;
    assert.equal(r.channel.wire, "anthropic-messages");
    assert.equal(r.channel.baseUrl, "https://relay.invalid/v1");
    assert.equal(r.channel.harnessBaseUrl, "https://relay.invalid");
    assert.equal(r.channel.model, "opus[1m]");

    await write(
      home,
      ".claude/settings.json",
      JSON.stringify({ model: "sonnet" }),
    );
    const def = await resolveHarnessChannel("claude", { homeDir: home });
    assert.equal(def.kind, "resolved");
    if (def.kind !== "resolved") return;
    assert.equal(def.channel.baseUrl, "https://api.anthropic.com/v1");
  } finally {
    await cleanup();
  }
});

test("宿主 D：固定端点；settings 有 model 则取之（字符串或 model.name 形态），无则 model 缺省", async () => {
  const { home, cleanup } = await makeHome();
  try {
    const noSettings = await resolveHarnessChannel("gemini", { homeDir: home });
    assert.equal(noSettings.kind, "resolved");
    if (noSettings.kind !== "resolved") return;
    assert.equal(
      noSettings.channel.baseUrl,
      "https://generativelanguage.googleapis.com/v1beta",
    );
    assert.equal(noSettings.channel.model, undefined);

    await write(
      home,
      ".gemini/settings.json",
      JSON.stringify({ model: { name: "gemini-3-pro" } }),
    );
    const withName = await resolveHarnessChannel("gemini", { homeDir: home });
    assert.equal(withName.kind, "resolved");
    if (withName.kind !== "resolved") return;
    assert.equal(withName.channel.model, "gemini-3-pro");
  } finally {
    await cleanup();
  }
});

test("宿主 E：defaultProvider/defaultModel + models.json 的 baseUrl 与 api → wire 映射", async () => {
  const { home, cleanup } = await makeHome();
  try {
    await write(
      home,
      ".pi/agent/settings.json",
      JSON.stringify({
        defaultProvider: "deepseek",
        defaultModel: "deepseek-v4-flash-vision-exp",
      }),
    );
    await write(
      home,
      ".pi/agent/models.json",
      JSON.stringify({
        providers: {
          deepseek: {
            baseUrl: "https://api.deepseek.com",
            api: "openai-completions",
            models: [],
          },
        },
      }),
    );
    const r = await resolveHarnessChannel("pi", { homeDir: home });
    assert.equal(r.kind, "resolved");
    if (r.kind !== "resolved") return;
    assert.equal(r.channel.wire, "openai-chat");
    assert.equal(r.channel.baseUrl, "https://api.deepseek.com");
    assert.equal(r.channel.model, "deepseek-v4-flash-vision-exp");

    await write(
      home,
      ".pi/agent/models.json",
      JSON.stringify({
        providers: {
          deepseek: {
            baseUrl: "https://api.deepseek.com",
            api: "mystery-api",
            models: [],
          },
        },
      }),
    );
    const unknown = await resolveHarnessChannel("pi", { homeDir: home });
    assert.equal(unknown.kind, "missing");
    if (unknown.kind !== "missing") return;
    assert.match(unknown.reason, /mystery-api/);
  } finally {
    await cleanup();
  }
});

test("宿主 E：models.json 无内置 provider 条目时回退内置表（裸 from: harness 可解析宿主默认渠道）", async () => {
  const { home, cleanup } = await makeHome();
  try {
    await write(
      home,
      ".pi/agent/settings.json",
      JSON.stringify({
        defaultProvider: "deepseek",
        defaultModel: "deepseek-v4-flash",
      }),
    );
    await write(
      home,
      ".pi/agent/models.json",
      JSON.stringify({ providers: {} }),
    );
    const r = await resolveHarnessChannel("pi", { homeDir: home });
    assert.equal(r.kind, "resolved");
    if (r.kind !== "resolved") return;
    assert.equal(r.channel.wire, "openai-chat");
    assert.equal(r.channel.baseUrl, "https://api.deepseek.com");
    assert.equal(r.channel.model, "deepseek-v4-flash");
    assert.equal(r.channel.provider, "deepseek");
    assert.match(r.channel.source, /内置/);
  } finally {
    await cleanup();
  }
});

test("宿主 E：models.json 条目优先于内置表（用户覆盖内置渠道仍生效）", async () => {
  const { home, cleanup } = await makeHome();
  try {
    await write(
      home,
      ".pi/agent/settings.json",
      JSON.stringify({
        defaultProvider: "deepseek",
        defaultModel: "deepseek-v4-flash",
      }),
    );
    await write(
      home,
      ".pi/agent/models.json",
      JSON.stringify({
        providers: {
          deepseek: {
            baseUrl: "https://relay.example.com/v1",
            api: "openai-completions",
            models: [],
          },
        },
      }),
    );
    const r = await resolveHarnessChannel("pi", { homeDir: home });
    assert.equal(r.kind, "resolved");
    if (r.kind !== "resolved") return;
    assert.equal(r.channel.baseUrl, "https://relay.example.com/v1");
    assert.doesNotMatch(r.channel.source, /内置/);
  } finally {
    await cleanup();
  }
});

test("宿主 E：models.json 自定义条目缺 baseUrl → 显式 missing，不回退内置表掩盖配置错误", async () => {
  const { home, cleanup } = await makeHome();
  try {
    await write(
      home,
      ".pi/agent/settings.json",
      JSON.stringify({
        defaultProvider: "deepseek",
        defaultModel: "deepseek-v4-flash",
      }),
    );
    await write(
      home,
      ".pi/agent/models.json",
      JSON.stringify({
        providers: { deepseek: { api: "openai-completions", models: [] } },
      }),
    );
    const r = await resolveHarnessChannel("pi", { homeDir: home });
    assert.equal(r.kind, "missing");
    if (r.kind !== "missing") return;
    assert.match(r.reason, /自定义 provider "deepseek" 缺 baseUrl/);
  } finally {
    await cleanup();
  }
});

test("宿主 E：provider 既不在 models.json 也不在内置表 → missing 且提及内置表", async () => {
  const { home, cleanup } = await makeHome();
  try {
    await write(
      home,
      ".pi/agent/settings.json",
      JSON.stringify({
        defaultProvider: "mystery-provider",
        defaultModel: "mystery-model",
      }),
    );
    const r = await resolveHarnessChannel("pi", { homeDir: home });
    assert.equal(r.kind, "missing");
    if (r.kind !== "missing") return;
    assert.match(r.reason, /mystery-provider/);
    assert.match(r.reason, /内置/);
  } finally {
    await cleanup();
  }
});

test("宿主 E：provider hint 命中 models.json 自定义 provider，hint ≠ defaultProvider 时不带 model", async () => {
  const { home, cleanup } = await makeHome();
  try {
    await write(
      home,
      ".pi/agent/settings.json",
      JSON.stringify({
        defaultProvider: "deepseek",
        defaultModel: "deepseek-v4-flash",
      }),
    );
    await write(
      home,
      ".pi/agent/models.json",
      JSON.stringify({
        providers: {
          "custom-relay": {
            baseUrl: "https://relay.example.com/v1",
            api: "openai-completions",
            models: [],
          },
        },
      }),
    );
    const r = await resolveHarnessChannel("pi", {
      homeDir: home,
      provider: "custom-relay",
    });
    assert.equal(r.kind, "resolved");
    if (r.kind !== "resolved") return;
    assert.equal(r.channel.provider, "custom-relay");
    assert.equal(r.channel.baseUrl, "https://relay.example.com/v1");
    assert.equal(r.channel.wire, "openai-chat");
    assert.equal(r.channel.model, undefined);
  } finally {
    await cleanup();
  }
});

test("宿主 E：provider hint 命中内置表；hint === defaultProvider 时沿用 defaultModel", async () => {
  const { home, cleanup } = await makeHome();
  try {
    await write(
      home,
      ".pi/agent/settings.json",
      JSON.stringify({
        defaultProvider: "kimi-coding",
        defaultModel: "kimi-for-coding",
      }),
    );
    const hinted = await resolveHarnessChannel("pi", {
      homeDir: home,
      provider: "kimi-coding",
    });
    assert.equal(hinted.kind, "resolved");
    if (hinted.kind !== "resolved") return;
    assert.equal(hinted.channel.provider, "kimi-coding");
    assert.equal(hinted.channel.baseUrl, "https://api.kimi.com/coding/v1");
    assert.equal(hinted.channel.harnessBaseUrl, "https://api.kimi.com/coding");
    assert.equal(hinted.channel.wire, "anthropic-messages");
    assert.equal(hinted.channel.model, "kimi-for-coding");
    assert.match(hinted.channel.source, /内置/);
  } finally {
    await cleanup();
  }
});

test("宿主 E：provider hint 不存在 → missing，不回退 defaultProvider", async () => {
  const { home, cleanup } = await makeHome();
  try {
    await write(
      home,
      ".pi/agent/settings.json",
      JSON.stringify({
        defaultProvider: "deepseek",
        defaultModel: "deepseek-v4-flash",
      }),
    );
    await write(
      home,
      ".pi/agent/models.json",
      JSON.stringify({ providers: {} }),
    );
    const r = await resolveHarnessChannel("pi", {
      homeDir: home,
      provider: "mystery-provider",
    });
    assert.equal(r.kind, "missing");
    if (r.kind !== "missing") return;
    assert.match(r.reason, /mystery-provider/);
    assert.match(r.reason, /内置/);
    assert.doesNotMatch(r.reason, /deepseek/);
  } finally {
    await cleanup();
  }
});

test("宿主 E：未给 provider hint 时行为不变（锚定 defaultProvider/defaultModel）", async () => {
  const { home, cleanup } = await makeHome();
  try {
    await write(
      home,
      ".pi/agent/settings.json",
      JSON.stringify({
        defaultProvider: "deepseek",
        defaultModel: "deepseek-v4-flash",
      }),
    );
    const r = await resolveHarnessChannel("pi", { homeDir: home });
    assert.equal(r.kind, "resolved");
    if (r.kind !== "resolved") return;
    assert.equal(r.channel.provider, "deepseek");
    assert.equal(r.channel.model, "deepseek-v4-flash");
  } finally {
    await cleanup();
  }
});

test("未知 carrier 的渠道借用 → missing 并说明不支持", async () => {
  const r = await resolveHarnessChannel("unknown-cli", {
    homeDir: "/nonexistent",
  });
  assert.equal(r.kind, "missing");
  if (r.kind !== "missing") return;
  assert.match(r.reason, /未探测|不支持/);
});

test("from: harness：load 时借用渠道+model，yaml 显式字段覆盖借用值，credential 隐含 harness", async () => {
  const { home, cleanup } = await makeHome();
  try {
    await write(
      home,
      ".kimi-code/config.toml",
      [
        'default_model = "kimi-code/k3-256k"',
        '[providers."managed:kimi-code"]',
        'type = "kimi"',
        'base_url = "https://api.kimi.com/coding/v1"',
        "",
      ].join("\n"),
    );
    const repo = join(home, "repo");
    await write(
      repo,
      ".env.e2e.yaml",
      "carriers:\n  kimi:\n    from: harness\n    model: k3-override\n",
    );
    const load = await loadLiveConfig({
      env: {},
      repoRoot: repo,
      homeDir: home,
      ...createHarnessLiveConfigHooks(home),
    });
    assert.equal(load.kind, "loaded");
    const r = resolveLiveChannel(load, "kimi", {});
    assert.equal(r.kind, "configured");
    if (r.kind !== "configured") return;
    assert.equal(r.channel.baseUrl, "https://api.kimi.com/coding/v1");
    assert.equal(r.channel.wire, "openai-chat");
    assert.equal(r.channel.model, "k3-override");
    assert.equal(r.channel.credential, "harness");
  } finally {
    await cleanup();
  }
});

test("from: harness + provider：借用宿主 E 非默认 provider 的渠道（内置表命中），model 显式声明", async () => {
  const { home, cleanup } = await makeHome();
  try {
    await write(
      home,
      ".pi/agent/settings.json",
      JSON.stringify({
        defaultProvider: "deepseek",
        defaultModel: "deepseek-v4-flash",
      }),
    );
    const repo = join(home, "repo");
    await write(
      repo,
      ".env.e2e.yaml",
      "carriers:\n  pi:\n    from: harness\n    provider: kimi-coding\n    model: kimi-for-coding\n",
    );
    const load = await loadLiveConfig({
      env: {},
      repoRoot: repo,
      homeDir: home,
      ...createHarnessLiveConfigHooks(home),
    });
    assert.equal(load.kind, "loaded");
    const r = resolveLiveChannel(load, "pi", {});
    assert.equal(r.kind, "configured");
    if (r.kind !== "configured") return;
    assert.equal(r.channel.provider, "kimi-coding");
    assert.equal(r.channel.baseUrl, "https://api.kimi.com/coding/v1");
    assert.equal(r.channel.harnessBaseUrl, "https://api.kimi.com/coding");
    assert.equal(r.channel.wire, "anthropic-messages");
    assert.equal(r.channel.model, "kimi-for-coding");
    assert.equal(r.channel.credential, "harness");
  } finally {
    await cleanup();
  }
});

test("from: harness 但宿主配置缺失/不完整 → invalid 进 not-configured，原因可读", async () => {
  const { home, cleanup } = await makeHome();
  try {
    const repo = join(home, "repo");
    await write(
      repo,
      ".env.e2e.yaml",
      "carriers:\n  codex:\n    from: harness\n",
    );
    const load = await loadLiveConfig({
      env: {},
      repoRoot: repo,
      homeDir: home,
      ...createHarnessLiveConfigHooks(home),
    });
    assert.equal(load.kind, "loaded");
    const r = resolveLiveChannel(load, "codex", {});
    assert.equal(r.kind, "not-configured");
    if (r.kind !== "not-configured") return;
    assert.match(r.reason, /config\.toml|harness/);
  } finally {
    await cleanup();
  }
});
