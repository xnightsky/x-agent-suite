/**
 * @module @x-agent-suite/llm-fixture/tests/live-config-targets
 * 多 provider 可选目录、默认目标、宿主默认继承与旧格式弃用告警测试。
 * 不变量：全部使用临时目录与注入钩子，零网络、零 token。
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { stringify as stringifyYaml } from "yaml";
import {
  loadLiveConfig,
  resolveLiveChannel,
  resolveLiveTargets,
} from "@x-agent-suite/llm-fixture";

/** 创建隔离配置目录。 */
async function makeDirs(): Promise<{
  root: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(join(os.tmpdir(), "xas-live-targets-"));
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

/** 写入一份仅含 carriers 的 YAML。 */
async function writeConfig(
  path: string,
  carriers: Record<string, unknown>,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, stringifyYaml({ carriers }), "utf8");
}

/** 构造直接连接 provider，避免测试依赖宿主借用。 */
function directProvider(models: readonly string[]): Record<string, unknown> {
  return {
    wire: "openai-chat",
    baseUrl: "https://targets.example.com/v1",
    apiKey: "synthetic-target-key",
    models,
  };
}

test("新格式：可选目录保持声明顺序，default 字符串归一为 provider/model", async () => {
  const { root, cleanup } = await makeDirs();
  try {
    const repoRoot = join(root, "repo");
    await writeConfig(join(repoRoot, ".env.e2e.yaml"), {
      "carrier-a": {
        providers: {
          "provider-a": directProvider(["shared", "model-a"]),
          "provider-b": directProvider(["shared", "model-b"]),
        },
        default: ["model-a", "provider-b/model-b"],
      },
    });

    const load = await loadLiveConfig({
      env: {},
      repoRoot,
      homeDir: join(root, "home"),
    });
    assert.equal(load.kind, "loaded");
    if (load.kind !== "loaded") return;
    assert.deepEqual(
      load.available["carrier-a"]?.map(({ provider, model }) => [
        provider,
        model,
      ]),
      [
        ["provider-a", "shared"],
        ["provider-a", "model-a"],
        ["provider-b", "shared"],
        ["provider-b", "model-b"],
      ],
    );
    assert.deepEqual(
      load.defaults["carrier-a"]?.map(({ provider, model }) => [
        provider,
        model,
      ]),
      [
        ["provider-a", "model-a"],
        ["provider-b", "model-b"],
      ],
    );
    assert.deepEqual(load.warnings, []);
    assert.equal(resolveLiveChannel(load, "carrier-a", {}).kind, "configured");
  } finally {
    await cleanup();
  }
});

test("新格式：default 接受字符串、对象及各自列表，default: [] 禁用默认执行", async () => {
  const { root, cleanup } = await makeDirs();
  try {
    const repoRoot = join(root, "repo");
    await writeConfig(join(repoRoot, ".env.e2e.yaml"), {
      single: {
        providers: { "provider-a": directProvider(["model-a"]) },
        default: { provider: "provider-a", model: "model-a" },
      },
      "single-string": {
        providers: { "provider-a": directProvider(["model-a"]) },
        default: "model-a",
      },
      multiple: {
        providers: {
          "provider-a": directProvider(["model-a", "model-b"]),
        },
        default: [
          { provider: "provider-a", model: "model-b" },
          { provider: "provider-a", model: "model-a" },
        ],
      },
      disabled: {
        providers: { "provider-a": directProvider(["model-a"]) },
        default: [],
      },
      "without-default": {
        providers: { "provider-a": directProvider(["model-a"]) },
      },
    });

    const load = await loadLiveConfig({
      env: {},
      repoRoot,
      homeDir: join(root, "home"),
    });
    assert.equal(load.kind, "loaded");
    if (load.kind !== "loaded") return;
    assert.equal(load.defaults.single?.[0]?.model, "model-a");
    assert.equal(load.defaults["single-string"]?.[0]?.model, "model-a");
    assert.deepEqual(
      load.defaults.multiple?.map(({ model }) => model),
      ["model-b", "model-a"],
    );
    assert.deepEqual(load.defaults.disabled, []);
    assert.deepEqual(load.defaults["without-default"], []);
    assert.equal(load.channels.disabled, undefined);
    assert.equal(load.available.disabled?.length, 1);
  } finally {
    await cleanup();
  }
});

test("新格式：歧义模型、游离 default 与新旧混用均显式 invalid", async () => {
  const { root, cleanup } = await makeDirs();
  try {
    const repoRoot = join(root, "repo");
    await writeConfig(join(repoRoot, ".env.e2e.yaml"), {
      ambiguous: {
        providers: {
          "provider-a": directProvider(["shared"]),
          "provider-b": directProvider(["shared"]),
        },
        default: "shared",
      },
      dangling: {
        providers: { "provider-a": directProvider(["model-a"]) },
        default: "missing",
      },
      mixed: {
        provider: "legacy-provider",
        model: "legacy-model",
        providers: { "provider-a": directProvider(["model-a"]) },
        default: "model-a",
      },
      healthy: {
        providers: { "provider-a": directProvider(["model-a"]) },
        default: "model-a",
      },
    });

    const load = await loadLiveConfig({
      env: {},
      repoRoot,
      homeDir: join(root, "home"),
    });
    assert.equal(load.kind, "loaded");
    if (load.kind !== "loaded") return;
    assert.match(load.invalid.ambiguous ?? "", /歧义|唯一/);
    assert.match(load.invalid.dangling ?? "", /missing|可选|存在/);
    assert.match(load.invalid.mixed ?? "", /新旧格式混用/);
    assert.equal(resolveLiveTargets(load).kind, "not-configured");
  } finally {
    await cleanup();
  }
});

test("from: harness 未声明 default：继承 CLI 默认目标并自动并入可选目录", async () => {
  const { root, cleanup } = await makeDirs();
  try {
    const repoRoot = join(root, "repo");
    await writeConfig(join(repoRoot, ".env.e2e.yaml"), {
      "carrier-a": {
        from: "harness",
        providers: {
          "provider-a": { models: ["model-a"] },
        },
      },
    });

    const load = await loadLiveConfig({
      env: {},
      repoRoot,
      homeDir: join(root, "home"),
      borrowChannel: (_carrier, _home, options) =>
        Promise.resolve({
          kind: "resolved" as const,
          wire: "openai-chat" as const,
          baseUrl: "https://borrowed-targets.example.com/v1",
          provider: options?.provider ?? "host-provider",
          model: options?.provider ? undefined : "host-model",
          source: "synthetic",
        }),
    });
    assert.equal(load.kind, "loaded");
    if (load.kind !== "loaded") return;
    assert.deepEqual(
      load.defaults["carrier-a"]?.map(({ provider, model }) => [
        provider,
        model,
      ]),
      [["host-provider", "host-model"]],
    );
    assert.deepEqual(
      load.available["carrier-a"]?.map(({ provider, model }) => [
        provider,
        model,
      ]),
      [
        ["provider-a", "model-a"],
        ["host-provider", "host-model"],
      ],
    );
  } finally {
    await cleanup();
  }
});

test("from: harness 继承默认命中目录时复用完整渠道配置", async () => {
  const { root, cleanup } = await makeDirs();
  try {
    const repoRoot = join(root, "repo");
    await writeConfig(join(repoRoot, ".env.e2e.yaml"), {
      "carrier-a": {
        from: "harness",
        providers: {
          "host-provider": {
            baseUrl: "https://borrowed-targets.example.com/v1",
            apiKey: "synthetic-configured-key",
            models: ["host-model"],
          },
        },
      },
    });
    const load = await loadLiveConfig({
      env: {},
      repoRoot,
      homeDir: join(root, "home"),
      borrowChannel: (_carrier, _home, options) =>
        Promise.resolve({
          kind: "resolved" as const,
          wire: "openai-chat" as const,
          baseUrl: "https://borrowed-targets.example.com/v1",
          provider: "host-provider",
          model: options?.provider ? undefined : "host-model",
          source: "synthetic",
        }),
    });
    assert.equal(load.kind, "loaded");
    if (load.kind !== "loaded") return;
    const available = load.available["carrier-a"];
    const inherited = load.defaults["carrier-a"]?.[0];
    assert.equal(available?.length, 1);
    assert.strictEqual(inherited, available?.[0]);
    assert.equal(inherited?.apiKey, "synthetic-configured-key");
  } finally {
    await cleanup();
  }
});

test("from: harness provider-less 继承目标归一唯一逻辑 provider", async () => {
  const { root, cleanup } = await makeDirs();
  try {
    const repoRoot = join(root, "repo");
    await writeConfig(join(repoRoot, ".env.e2e.yaml"), {
      "carrier-a": {
        from: "harness",
        providers: { logical: { models: ["host-model"] } },
      },
      "carrier-b": {
        from: "harness",
        providers: {
          "logical-a": { models: ["host-model"] },
          "logical-b": { models: ["host-model"] },
        },
      },
    });
    const load = await loadLiveConfig({
      env: {},
      repoRoot,
      homeDir: join(root, "home"),
      borrowChannel: (_carrier, _home, options) =>
        Promise.resolve({
          kind: "resolved" as const,
          wire: "openai-chat" as const,
          baseUrl: "https://borrowed-targets.example.com/v1",
          provider: options?.provider,
          model: options?.provider ? undefined : "host-model",
          source: "synthetic",
        }),
    });
    assert.equal(load.kind, "loaded");
    if (load.kind !== "loaded") return;
    assert.match(load.invalid["carrier-b"] ?? "", /多个可选 provider/);
    const available = load.available["carrier-a"];
    assert.equal(available?.length, 1);
    assert.strictEqual(load.defaults["carrier-a"]?.[0], available?.[0]);
    assert.equal(available?.[0]?.provider, "logical");
    const selected = resolveLiveTargets(load, {
      carrier: "carrier-a",
      model: "host-model",
    });
    assert.equal(selected.kind, "configured");
    if (selected.kind === "configured") {
      assert.equal(selected.targets.length, 1);
      assert.strictEqual(selected.targets[0]?.channel, available?.[0]);
    }
  } finally {
    await cleanup();
  }
});

test("旧 provider/model 保留行为并产生结构化 warning；裸 harness 不告警", async () => {
  const { root, cleanup } = await makeDirs();
  try {
    const repoRoot = join(root, "repo");
    await writeConfig(join(repoRoot, ".env.e2e.yaml"), {
      legacy: {
        from: "harness",
        provider: "legacy-provider",
        model: "legacy-model",
      },
      direct: {
        wire: "openai-chat",
        baseUrl: "https://direct-legacy.example.com/v1",
        model: "direct-model",
        apiKey: "synthetic-direct-key",
      },
      bare: { from: "harness" },
    });

    const load = await loadLiveConfig({
      env: {},
      repoRoot,
      homeDir: join(root, "home"),
      borrowChannel: (_carrier, _home, options) =>
        Promise.resolve({
          kind: "resolved" as const,
          wire: "openai-chat" as const,
          baseUrl: "https://legacy.example.com/v1",
          provider: options?.provider ?? "host-provider",
          model: options?.provider ? undefined : "host-model",
          source: "synthetic",
        }),
    });
    assert.equal(load.kind, "loaded");
    if (load.kind !== "loaded") return;
    assert.equal(load.warnings.length, 2);
    assert.deepEqual(
      load.warnings.map(({ carrier }) => carrier),
      ["legacy", "direct"],
    );
    assert.ok(
      load.warnings.every(({ code }) => code === "deprecated-carrier-model"),
    );
    assert.ok(
      !load.warnings.some(({ message }) =>
        message.includes("legacy.example.com"),
      ),
    );
    assert.equal(resolveLiveChannel(load, "legacy", {}).kind, "configured");
    assert.equal(resolveLiveChannel(load, "bare", {}).kind, "configured");
  } finally {
    await cleanup();
  }
});

test("target 选择：默认跨 carrier 汇总，显式模型忽略 default 并做唯一性校验", async () => {
  const { root, cleanup } = await makeDirs();
  try {
    const repoRoot = join(root, "repo");
    await writeConfig(join(repoRoot, ".env.e2e.yaml"), {
      "carrier-a": {
        providers: {
          "provider-a": directProvider([
            "model-a",
            "shared",
            "default/glm5-3-flash",
          ]),
          "provider-b": directProvider(["shared", "model-b"]),
        },
        default: "provider-a/model-a",
      },
      "carrier-b": {
        providers: { "provider-c": directProvider(["model-c"]) },
        default: "model-c",
      },
    });
    const load = await loadLiveConfig({
      env: {},
      repoRoot,
      homeDir: join(root, "home"),
    });
    assert.equal(load.kind, "loaded");

    const defaults = resolveLiveTargets(load);
    assert.equal(defaults.kind, "configured");
    if (defaults.kind === "configured") {
      assert.deepEqual(
        defaults.targets.map(({ carrier, channel }) => [
          carrier,
          channel.model,
        ]),
        [
          ["carrier-a", "model-a"],
          ["carrier-b", "model-c"],
        ],
      );
    }

    const fuzzy = resolveLiveTargets(load, { model: "del-b" });
    assert.equal(fuzzy.kind, "configured");
    if (fuzzy.kind === "configured") {
      assert.equal(fuzzy.targets[0]?.channel.model, "model-b");
      assert.equal(fuzzy.targets[0]?.channel.provider, "provider-b");
    }

    const qualified = resolveLiveTargets(load, {
      carrier: "carrier-a",
      model: "provider-a/default/glm5-3-flash",
    });
    assert.equal(qualified.kind, "configured");
    if (qualified.kind === "configured") {
      assert.equal(qualified.targets.length, 1);
      assert.equal(qualified.targets[0]?.channel.provider, "provider-a");
      assert.equal(qualified.targets[0]?.channel.model, "default/glm5-3-flash");
    }

    const ambiguous = resolveLiveTargets(load, { model: "shared" });
    assert.equal(ambiguous.kind, "not-configured");
    if (ambiguous.kind === "not-configured") {
      assert.match(ambiguous.reason, /歧义|候选|唯一/);
    }

    const selected = resolveLiveTargets(load, {
      carrier: "carrier-a",
      provider: "provider-b",
      model: "shared",
    });
    assert.equal(selected.kind, "configured");
    if (selected.kind === "configured") {
      assert.deepEqual(
        selected.targets.map(({ carrier, channel }) => [
          carrier,
          channel.provider,
          channel.model,
        ]),
        [["carrier-a", "provider-b", "shared"]],
      );
    }
  } finally {
    await cleanup();
  }
});

test("target 选择：default: [] 无默认目标，但仍可显式选择可选模型", async () => {
  const { root, cleanup } = await makeDirs();
  try {
    const repoRoot = join(root, "repo");
    await writeConfig(join(repoRoot, ".env.e2e.yaml"), {
      "carrier-a": {
        providers: { "provider-a": directProvider(["model-a"]) },
        default: [],
      },
    });
    const load = await loadLiveConfig({
      env: {},
      repoRoot,
      homeDir: join(root, "home"),
    });
    assert.equal(resolveLiveTargets(load).kind, "not-configured");
    assert.equal(
      resolveLiveTargets(load, { carrier: "carrier-a", model: "model-a" }).kind,
      "configured",
    );
  } finally {
    await cleanup();
  }
});
