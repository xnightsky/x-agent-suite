/**
 * @module @x-agent-suite/llm-fixture/tests/live-auth-sniff
 * sniff 对认证文件来源、失败门禁与脱敏的集成测试。
 * 不变量：临时目录、合成 secret、注入 transport、零真实请求。
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  sniffLiveChannel,
  type LiveChannel,
  type LiveTransport,
} from "@x-agent-suite/llm-fixture";

async function workspace(t: import("node:test").TestContext): Promise<string> {
  const root = await mkdtemp(join(os.tmpdir(), "xas-auth-sniff-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function channel(overrides: Partial<LiveChannel> = {}): LiveChannel {
  return {
    wire: "openai-chat",
    baseUrl: "https://example.invalid/v1",
    model: "model-a",
    provider: "provider-a",
    credentialSource: "model-config",
    ...overrides,
  };
}

const TOOL_RESPONSE = JSON.stringify({
  model: "model-a",
  choices: [
    {
      message: {
        role: "assistant",
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: {
              name: "__e2e_sniff_probe",
              arguments: '{"echo":"ping"}',
            },
          },
        ],
      },
      finish_reason: "tool_calls",
    },
  ],
});

test("sniff 与 backend 共用 auth-file 凭据来源", async (t) => {
  const root = await workspace(t);
  await writeFile(
    join(root, ".env.auth.yaml"),
    "version: 1\nproviders:\n  provider-a:\n    type: api_key\n    apiKeyEnv: AUTH_FILE_KEY\n",
  );
  let authorization = "";
  const transport: LiveTransport = async (request) => {
    authorization = request.headers.authorization ?? "";
    return { status: 200, text: TOOL_RESPONSE };
  };
  const result = await sniffLiveChannel("carrier-a", channel(), {
    repoRoot: root,
    homeDir: root,
    env: { AUTH_FILE_KEY: "auth-file-secret" },
    transport,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(authorization, "Bearer auth-file-secret");
});

test("sniff 在已选认证来源缺值时不发请求并返回 auth 失败", async (t) => {
  const root = await workspace(t);
  await writeFile(
    join(root, ".env.auth.yaml"),
    "version: 1\nproviders:\n  provider-a:\n    type: api_key\n    apiKeyEnv: MISSING_AUTH_KEY\n",
  );
  let calls = 0;
  const result = await sniffLiveChannel("carrier-a", channel(), {
    repoRoot: root,
    homeDir: root,
    env: {},
    transport: async () => {
      calls += 1;
      return { status: 200, text: TOOL_RESPONSE };
    },
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.stage, "auth");
  assert.match(result.reason, /MISSING_AUTH_KEY/);
  assert.equal(calls, 0);
});

test("空字符串 runtime 覆盖不得回退认证文件或发送请求", async (t) => {
  const root = await workspace(t);
  await writeFile(
    join(root, ".env.auth.yaml"),
    "version: 1\nproviders:\n  provider-a:\n    type: api_key\n    apiKey: must-not-fallback\n",
  );
  for (const field of ["apiKey", "apiKeyEnv"] as const) {
    let calls = 0;
    const result = await sniffLiveChannel(
      "carrier-a",
      channel({ credentialSource: "runtime", [field]: "" }),
      {
        repoRoot: root,
        homeDir: root,
        env: {},
        transport: async () => {
          calls += 1;
          return { status: 200, text: TOOL_RESPONSE };
        },
      },
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.stage, "auth");
    assert.equal(calls, 0);
  }
});

test("sniff 将认证文件错误收敛为脱敏 auth 失败", async (t) => {
  const root = await workspace(t);
  const secret = "synthetic-malformed-auth-secret";
  await writeFile(
    join(root, ".env.auth.yaml"),
    `version: 1\nproviders:\n  provider-a:\n    type: api_key\n    apiKey: ${secret}\n    broken: [\n`,
  );
  const result = await sniffLiveChannel("carrier-a", channel(), {
    repoRoot: root,
    homeDir: root,
    env: {},
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.stage, "auth");
  assert.doesNotMatch(result.reason, new RegExp(secret));
  assert.doesNotMatch(result.reason, /broken:/);
});

test("sniff 连通异常脱敏 auth 字面量", async (t) => {
  const root = await workspace(t);
  const secret = "synthetic-sniff-auth-secret";
  await writeFile(
    join(root, ".env.auth.yaml"),
    `version: 1\nproviders:\n  provider-a:\n    type: api_key\n    apiKey: ${secret}\n`,
  );
  const result = await sniffLiveChannel("carrier-a", channel(), {
    repoRoot: root,
    homeDir: root,
    env: {},
    transport: async () => {
      throw new Error(`authorization=${secret}`);
    },
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.doesNotMatch(result.reason, new RegExp(secret));
  assert.match(result.reason, /\[REDACTED\]/);
});
