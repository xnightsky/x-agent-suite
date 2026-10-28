/**
 * @module harness/tests/pi-live-config
 * 消费者 Pi 配置投影回归；合成宿主配置，零网络，不读取真实 HOME。
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createSandbox, cleanupSandbox } from "@x-agent-suite/sandbox";
import { writePiLiveConfig } from "../../../profiles/pi-config.ts";
import { piProfile } from "./fixtures/profiles/pi.ts";

const nativeModel = {
  id: "native-model",
  api: "openai-responses",
  reasoning: true,
  contextWindow: 256000,
  maxTokens: 32000,
  compat: { supportsStore: false },
  samplingParams: { temperature: 0.6 },
  thinkingLevelMap: { high: "deep", max: null },
  samplingParamsByThinkingLevel: { high: { top_p: 0.9 } },
};

test("live 隔离配置继承默认思考与原生模型事实，不复制宿主认证或扩展", async () => {
  const sandbox = await createSandbox({ configDirs: ["piHome", "host"] });
  try {
    const host = sandbox.configDirs!.host!;
    const settings = {
      defaultThinkingLevel: "high",
      thinkingBudgets: { high: 12345 },
      packages: ["untrusted"],
      secret: "host-secret",
    };
    const models = {
      providers: {
        native: {
          api: "openai-completions",
          apiKey: "!must-not-run",
          models: [nativeModel],
          modelOverrides: { "native-model": { maxTokens: 31000 } },
        },
      },
    };
    await writeFile(join(host, "settings.json"), JSON.stringify(settings));
    await writeFile(join(host, "models.json"), JSON.stringify(models));
    await writePiLiveConfig(
      sandbox,
      {
        baseUrl: "https://selected.invalid/v1",
        apiKey: "selected-key",
        injectServer: false,
        live: {
          provider: "native",
          model: "native-model",
          wire: "openai-responses",
        },
      },
      { agentDir: host },
    );
    const isolated = sandbox.configDirs!.piHome!;
    const projected = JSON.parse(
      await readFile(join(isolated, "models.json"), "utf8"),
    );
    const output = JSON.parse(
      await readFile(join(isolated, "settings.json"), "utf8"),
    );
    assert.equal(output.defaultThinkingLevel, "high");
    assert.deepEqual(output.thinkingBudgets, settings.thinkingBudgets);
    assert.equal(output.defaultProvider, "native");
    assert.equal(output.packages, undefined);
    assert.equal(output.secret, undefined);
    assert.deepEqual(projected.providers.native.models, [nativeModel]);
    assert.deepEqual(
      projected.providers.native.modelOverrides,
      models.providers.native.modelOverrides,
    );
    assert.equal(projected.providers.native.apiKey, "selected-key");
    assert.equal(
      projected.providers.native.baseUrl,
      "https://selected.invalid/v1",
    );
    assert.deepEqual(
      JSON.parse(await readFile(join(host, "settings.json"), "utf8")),
      settings,
    );
    assert.deepEqual(
      JSON.parse(await readFile(join(host, "models.json"), "utf8")),
      models,
    );
  } finally {
    await cleanupSandbox(sandbox);
  }
});

test("显式思考参数只修改隔离 settings；内建模型不伪造能力", async () => {
  const sandbox = await createSandbox({ configDirs: ["piHome", "host"] });
  try {
    const host = sandbox.configDirs!.host!;
    await writeFile(
      join(host, "settings.json"),
      '{"defaultThinkingLevel":"high"}',
    );
    const context = {
      baseUrl: "https://selected.invalid/v1",
      apiKey: "key",
      injectServer: false as const,
      live: { provider: "native", model: "builtin", wire: "openai-responses" },
    };
    await writePiLiveConfig(sandbox, context, {
      agentDir: host,
      executionParams: { thinkingLevel: "low" },
    });
    const dir = sandbox.configDirs!.piHome!;
    assert.equal(
      JSON.parse(await readFile(join(dir, "settings.json"), "utf8"))
        .defaultThinkingLevel,
      "low",
    );
    const provider = JSON.parse(
      await readFile(join(dir, "models.json"), "utf8"),
    ).providers.native;
    assert.equal(provider.models, undefined);
    assert.equal(provider.api, undefined);
    assert.equal(provider.reasoning, undefined);
    await assert.rejects(
      writePiLiveConfig(sandbox, context, {
        agentDir: host,
        executionParams: { thinkingLevel: "bogus" },
      }),
      /thinkingLevel/,
    );
    await assert.rejects(
      writePiLiveConfig(sandbox, context, {
        agentDir: host,
        executionParams: { apiKey: "DO_NOT_ECHO" },
      }),
      /不支持/,
    );
    await assert.rejects(
      writePiLiveConfig(sandbox, context, { agentDir: dir }),
      /隔离/,
    );
    await writeFile(join(host, "settings.json"), "{broken");
    await assert.rejects(
      writePiLiveConfig(sandbox, context, { agentDir: host }),
      /配置/,
    );
  } finally {
    await cleanupSandbox(sandbox);
  }
});

test("真实 Profile 的 live 分支继承宿主默认；fixture 才关闭思考", async () => {
  const sandbox = await createSandbox({ configDirs: ["piHome", "host"] });
  const previous = process.env.PI_CODING_AGENT_DIR;
  try {
    const host = sandbox.configDirs!.host!;
    process.env.PI_CODING_AGENT_DIR = host;
    await writeFile(
      join(host, "settings.json"),
      JSON.stringify({ defaultThinkingLevel: "high" }),
    );
    await writeFile(
      join(host, "models.json"),
      JSON.stringify({ providers: { native: { models: [nativeModel] } } }),
    );
    await piProfile.writeConfig(sandbox, {
      injectServer: false,
      baseUrl: "https://offline.invalid/v1",
      apiKey: "synthetic",
      live: {
        provider: "native",
        model: "native-model",
        wire: "openai-responses",
      },
    });
    const isolated = sandbox.configDirs!.piHome!;
    assert.equal(
      JSON.parse(await readFile(join(isolated, "settings.json"), "utf8"))
        .defaultThinkingLevel,
      "high",
    );
    assert.equal(
      JSON.parse(await readFile(join(isolated, "models.json"), "utf8"))
        .providers.native.models[0].reasoning,
      true,
    );
    await writeFile(join(host, "settings.json"), "{}");
    await piProfile.writeConfig(sandbox, {
      injectServer: false,
      baseUrl: "https://offline.invalid/v1",
      apiKey: "synthetic",
      live: {
        provider: "native",
        model: "native-model",
        wire: "openai-responses",
      },
    });
    assert.equal(
      JSON.parse(await readFile(join(isolated, "settings.json"), "utf8"))
        .defaultThinkingLevel,
      undefined,
    );
    await piProfile.writeConfig(sandbox, {
      injectServer: false,
      baseUrl: "http://127.0.0.1:4321",
      apiKey: "fake",
    });
    assert.equal(
      JSON.parse(await readFile(join(isolated, "settings.json"), "utf8"))
        .defaultThinkingLevel,
      "off",
    );
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await cleanupSandbox(sandbox);
  }
});
