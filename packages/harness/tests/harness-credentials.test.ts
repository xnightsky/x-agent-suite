/**
 * @module @x-agent-suite/harness/tests/harness-credentials
 * 借用宿主登录态（credential: harness）的凭证提取测试。
 * 不变量：全部指向临时目录里的假凭证文件（假 token / 假 JWT），不读真实 home，零网络。
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  resolveLiveCredential,
  type LiveChannel,
} from "@x-agent-suite/llm-fixture";
import { createHarnessLiveConfigHooks } from "@x-agent-suite/harness";
import { resolveHarnessCredential } from "../src/harness-credentials.ts";

async function makeHome(): Promise<{
  home: string;
  cleanup: () => Promise<void>;
}> {
  const home = await mkdtemp(join(os.tmpdir(), "xas-hcred-"));
  return { home, cleanup: () => rm(home, { recursive: true, force: true }) };
}

function fakeJwt(expSeconds: number): string {
  const b64 = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({ exp: expSeconds })}.fakesig`;
}

const NOW = Date.parse("2026-08-23T00:00:00Z");
const FUTURE = Math.floor(NOW / 1000) + 86400;
const PAST = Math.floor(NOW / 1000) - 86400;

test("宿主 B：OPENAI_API_KEY 字符串优先于 OAuth token", async () => {
  const { home, cleanup } = await makeHome();
  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await writeFile(
      join(home, ".codex", "auth.json"),
      JSON.stringify({
        auth_mode: "apikey",
        OPENAI_API_KEY: "sk-codex-static",
        tokens: { access_token: fakeJwt(FUTURE) },
      }),
    );
    const r = await resolveHarnessCredential("codex", {
      homeDir: home,
      now: NOW,
    });
    assert.equal(r.kind, "resolved");
    if (r.kind !== "resolved") return;
    assert.equal(r.apiKey, "sk-codex-static");
    assert.match(r.source, /auth\.json/);
  } finally {
    await cleanup();
  }
});

test("宿主 B：chatgpt 模式借用 access_token，回报 JWT exp；过期则 missing", async () => {
  const { home, cleanup } = await makeHome();
  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await writeFile(
      join(home, ".codex", "auth.json"),
      JSON.stringify({
        auth_mode: "chatgpt",
        OPENAI_API_KEY: null,
        tokens: { access_token: fakeJwt(FUTURE) },
      }),
    );
    const ok = await resolveHarnessCredential("codex", {
      homeDir: home,
      now: NOW,
    });
    assert.equal(ok.kind, "resolved");
    if (ok.kind !== "resolved") return;
    assert.equal(ok.expiresAt, FUTURE * 1000);

    await writeFile(
      join(home, ".codex", "auth.json"),
      JSON.stringify({
        auth_mode: "chatgpt",
        OPENAI_API_KEY: null,
        tokens: { access_token: fakeJwt(PAST) },
      }),
    );
    const expired = await resolveHarnessCredential("codex", {
      homeDir: home,
      now: NOW,
    });
    assert.equal(expired.kind, "missing");
    if (expired.kind !== "missing") return;
    assert.match(expired.reason, /过期/);
  } finally {
    await cleanup();
  }
});

test("宿主 B：auth.json 不存在 → missing 且给路径提示", async () => {
  const { home, cleanup } = await makeHome();
  try {
    const r = await resolveHarnessCredential("codex", {
      homeDir: home,
      now: NOW,
    });
    assert.equal(r.kind, "missing");
    if (r.kind !== "missing") return;
    assert.match(r.reason, /auth\.json/);
  } finally {
    await cleanup();
  }
});

test("宿主 C：settings.json 的 ANTHROPIC_AUTH_TOKEN 优先；OAuth 未过期可兜底，过期则 missing", async () => {
  const { home, cleanup } = await makeHome();
  try {
    await mkdir(join(home, ".claude"), { recursive: true });
    await writeFile(
      join(home, ".claude", "settings.json"),
      JSON.stringify({
        env: {
          ANTHROPIC_AUTH_TOKEN: "sk-ant-settings",
          ANTHROPIC_BASE_URL: "https://x.example.com",
        },
      }),
    );
    await writeFile(
      join(home, ".claude", ".credentials.json"),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "oauth-token",
          expiresAt: NOW + 86400_000,
        },
      }),
    );
    const fromSettings = await resolveHarnessCredential("claude", {
      homeDir: home,
      now: NOW,
    });
    assert.equal(fromSettings.kind, "resolved");
    if (fromSettings.kind !== "resolved") return;
    assert.equal(fromSettings.apiKey, "sk-ant-settings");

    await writeFile(
      join(home, ".claude", "settings.json"),
      JSON.stringify({ env: {} }),
    );
    const fromOauth = await resolveHarnessCredential("claude", {
      homeDir: home,
      now: NOW,
    });
    assert.equal(fromOauth.kind, "resolved");
    if (fromOauth.kind !== "resolved") return;
    assert.equal(fromOauth.apiKey, "oauth-token");

    await writeFile(
      join(home, ".claude", ".credentials.json"),
      JSON.stringify({
        claudeAiOauth: { accessToken: "oauth-token", expiresAt: NOW - 1000 },
      }),
    );
    const expired = await resolveHarnessCredential("claude", {
      homeDir: home,
      now: NOW,
    });
    assert.equal(expired.kind, "missing");
  } finally {
    await cleanup();
  }
});

test("宿主 E：按 provider 取静态 key；OAuth 过期与未知 provider 均 missing", async () => {
  const { home, cleanup } = await makeHome();
  try {
    await mkdir(join(home, ".pi", "agent"), { recursive: true });
    await writeFile(
      join(home, ".pi", "agent", "auth.json"),
      JSON.stringify({
        deepseek: { type: "api_key", key: "sk-pi-deepseek" },
        "kimi-coding": {
          type: "oauth",
          access: "pi-oauth",
          refresh: "r",
          expires: NOW - 1000,
        },
      }),
    );
    const staticKey = await resolveHarnessCredential("pi", {
      homeDir: home,
      now: NOW,
      provider: "deepseek",
    });
    assert.equal(staticKey.kind, "resolved");
    if (staticKey.kind !== "resolved") return;
    assert.equal(staticKey.apiKey, "sk-pi-deepseek");

    const expired = await resolveHarnessCredential("pi", {
      homeDir: home,
      now: NOW,
      provider: "kimi-coding",
    });
    assert.equal(expired.kind, "missing");
    if (expired.kind !== "missing") return;
    assert.match(expired.reason, /过期/);

    const unknown = await resolveHarnessCredential("pi", {
      homeDir: home,
      now: NOW,
      provider: "nope",
    });
    assert.equal(unknown.kind, "missing");

    const noProvider = await resolveHarnessCredential("pi", {
      homeDir: home,
      now: NOW,
    });
    assert.equal(noProvider.kind, "missing");
    if (noProvider.kind !== "missing") return;
    assert.match(noProvider.reason, /provider/);
  } finally {
    await cleanup();
  }
});

test("宿主 D：oauth_creds 未过期可借用；文件不存在 → missing", async () => {
  const { home, cleanup } = await makeHome();
  try {
    const absent = await resolveHarnessCredential("gemini", {
      homeDir: home,
      now: NOW,
    });
    assert.equal(absent.kind, "missing");

    await mkdir(join(home, ".gemini"), { recursive: true });
    await writeFile(
      join(home, ".gemini", "oauth_creds.json"),
      JSON.stringify({
        access_token: "gemini-oauth",
        expiry_date: NOW + 3600_000,
      }),
    );
    const ok = await resolveHarnessCredential("gemini", {
      homeDir: home,
      now: NOW,
    });
    assert.equal(ok.kind, "resolved");
    if (ok.kind !== "resolved") return;
    assert.equal(ok.apiKey, "gemini-oauth");
  } finally {
    await cleanup();
  }
});

test("未知 carrier 的 harness 借用 → missing 并说明未探测", async () => {
  const r = await resolveHarnessCredential("unknown-cli", {
    homeDir: "/nonexistent",
    now: NOW,
  });
  assert.equal(r.kind, "missing");
  if (r.kind !== "missing") return;
  assert.match(r.reason, /未探测|不支持/);
});

test("宿主 A：credentials/kimi-code.json 的 access_token 未过期可借用；过期与缺文件均 missing", async () => {
  const { home, cleanup } = await makeHome();
  try {
    const absent = await resolveHarnessCredential("kimi", {
      homeDir: home,
      now: NOW,
    });
    assert.equal(absent.kind, "missing");

    await mkdir(join(home, ".kimi-code", "credentials"), { recursive: true });
    await writeFile(
      join(home, ".kimi-code", "credentials", "kimi-code.json"),
      JSON.stringify({
        access_token: "kimi-oauth",
        refresh_token: "r",
        expires_at: Math.floor(NOW / 1000) + 1800,
        token_type: "Bearer",
      }),
    );
    const ok = await resolveHarnessCredential("kimi", {
      homeDir: home,
      now: NOW,
    });
    assert.equal(ok.kind, "resolved");
    if (ok.kind !== "resolved") return;
    assert.equal(ok.apiKey, "kimi-oauth");
    assert.equal(ok.expiresAt, NOW + 1800_000);

    await writeFile(
      join(home, ".kimi-code", "credentials", "kimi-code.json"),
      JSON.stringify({
        access_token: "kimi-oauth",
        expires_at: Math.floor(NOW / 1000) - 60,
      }),
    );
    const expired = await resolveHarnessCredential("kimi", {
      homeDir: home,
      now: NOW,
    });
    assert.equal(expired.kind, "missing");
    if (expired.kind !== "missing") return;
    assert.match(expired.reason, /过期/);
  } finally {
    await cleanup();
  }
});

test("resolveLiveCredential：apiKey 字面量 > apiKeyEnv > credential:harness 借用", async () => {
  const { home, cleanup } = await makeHome();
  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await writeFile(
      join(home, ".codex", "auth.json"),
      JSON.stringify({
        auth_mode: "chatgpt",
        OPENAI_API_KEY: null,
        tokens: { access_token: fakeJwt(FUTURE) },
      }),
    );
    const base = {
      wire: "openai-responses",
      baseUrl: "https://x.example.com/v1",
      model: "m",
    } as const;

    const hooks = createHarnessLiveConfigHooks(home);
    const literal: LiveChannel = {
      ...base,
      apiKey: "sk-literal",
    };
    const r1 = await resolveLiveCredential(literal, {
      carrier: "codex",
      env: {},
      homeDir: home,
      now: NOW,
      ...hooks,
    });
    assert.equal(r1.kind, "resolved");
    if (r1.kind === "resolved") assert.equal(r1.apiKey, "sk-literal");

    const viaEnv: LiveChannel = {
      ...base,
      apiKeyEnv: "MY_KEY",
    };
    const r2 = await resolveLiveCredential(viaEnv, {
      carrier: "codex",
      env: { MY_KEY: "sk-env" },
      homeDir: home,
      now: NOW,
      ...hooks,
    });
    assert.equal(r2.kind, "resolved");
    if (r2.kind === "resolved") assert.equal(r2.apiKey, "sk-env");

    const viaHarness: LiveChannel = {
      ...base,
      from: "harness",
      credential: "harness",
    };
    const r3 = await resolveLiveCredential(viaHarness, {
      carrier: "codex",
      env: {},
      homeDir: home,
      now: NOW,
      ...hooks,
      borrowChannel: async () => ({
        kind: "resolved",
        ...base,
        source: "synthetic",
      }),
    });
    assert.equal(r3.kind, "resolved");
    if (r3.kind !== "resolved") return;
    assert.match(r3.source, /harness/);

    const noCred: LiveChannel = { ...base };
    const r4 = await resolveLiveCredential(noCred, {
      carrier: "codex",
      env: {},
      homeDir: home,
      now: NOW,
      ...hooks,
    });
    assert.equal(r4.kind, "missing");
  } finally {
    await cleanup();
  }
});
