/**
 * @module @x-agent-suite/llm-fixture/tests/live-config-carriers
 * Carrier kind、临时 Client 与渠道目录复用的公开契约测试。
 * 不变量：全部使用临时目录和合成端点，零网络、零 token。
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { stringify as stringifyYaml } from "yaml";
import { loadLiveConfig, resolveLiveTargets } from "@x-agent-suite/llm-fixture";

async function makeDirs(): Promise<{
  root: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(join(os.tmpdir(), "xas-live-carriers-"));
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function writeConfig(
  path: string,
  carriers: Record<string, unknown>,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, stringifyYaml({ carriers }), "utf8");
}

function directProvider(models: readonly string[]): Record<string, unknown> {
  return {
    wire: "openai-chat",
    baseUrl: "https://carriers.example.com/v1",
    apiKey: "synthetic-carrier-key",
    models,
  };
}

test("Carrier kind 缺省 cli，ephemeral-client 复用渠道并保留独立 target 归因", async () => {
  const { root, cleanup } = await makeDirs();
  try {
    const repoRoot = join(root, "repo");
    await writeConfig(join(repoRoot, ".env.e2e.yaml"), {
      "carrier-a": {
        providers: { "provider-a": directProvider(["model-a", "model-b"]) },
        default: "model-b",
      },
      "ephemeral-a": {
        kind: "ephemeral-client",
        clientRef: "client-a",
        channelsFrom: "carrier-a",
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
    assert.deepEqual(load.invalid, {});
    assert.deepEqual(load.carriers?.["carrier-a"], { kind: "cli" });
    assert.deepEqual(load.carriers?.["ephemeral-a"], {
      kind: "ephemeral-client",
      clientRef: "client-a",
      channelCarrier: "carrier-a",
    });

    const selected = resolveLiveTargets(load, { carrier: "ephemeral-a" });
    assert.equal(selected.kind, "configured");
    if (selected.kind !== "configured") return;
    assert.equal(selected.targets.length, 1);
    const target = selected.targets[0]!;
    assert.equal(target.carrier, "ephemeral-a");
    assert.equal(target.kind, "ephemeral-client");
    assert.equal(target.clientRef, "client-a");
    assert.equal(target.channelCarrier, "carrier-a");
    assert.equal(target.channel.model, "model-a");
    assert.strictEqual(
      target.channel,
      load.available["carrier-a"]?.find(
        (channel) => channel.model === "model-a",
      ),
    );
    for (const key of ["kind", "clientRef", "channelsFrom"]) {
      assert.equal(key in target.channel, false, key + " 不得下传到 channel");
    }

    const cli = resolveLiveTargets(load, { carrier: "carrier-a" });
    assert.equal(cli.kind, "configured");
    if (cli.kind !== "configured") return;
    assert.equal(cli.targets[0]?.kind, "cli");
    assert.equal(cli.targets[0]?.channelCarrier, undefined);
    assert.equal(cli.targets[0]?.channel.model, "model-b");
  } finally {
    await cleanup();
  }
});

test("Carrier 非法 kind、clientRef 与 channelsFrom 引用均显式 invalid", async () => {
  const { root, cleanup } = await makeDirs();
  try {
    const repoRoot = join(root, "repo");
    await writeConfig(join(repoRoot, ".env.e2e.yaml"), {
      source: {
        providers: { "provider-a": directProvider(["model-a"]) },
        default: "model-a",
      },
      "source-reference": {
        kind: "cli",
        channelsFrom: "source",
      },
      "missing-client": {
        kind: "ephemeral-client",
        providers: { "provider-a": directProvider(["model-a"]) },
      },
      "cli-client": {
        kind: "cli",
        clientRef: "client-a",
        providers: { "provider-a": directProvider(["model-a"]) },
      },
      "bad-kind": {
        kind: "other",
        providers: { "provider-a": directProvider(["model-a"]) },
      },
      "mixed-channels": {
        kind: "ephemeral-client",
        clientRef: "client-a",
        channelsFrom: "source",
        providers: { "provider-a": directProvider(["model-a"]) },
      },
      chained: {
        kind: "ephemeral-client",
        clientRef: "client-a",
        channelsFrom: "source-reference",
      },
      "missing-source": {
        kind: "ephemeral-client",
        clientRef: "client-a",
        channelsFrom: "absent",
      },
    });

    const load = await loadLiveConfig({
      env: {},
      repoRoot,
      homeDir: join(root, "home"),
    });
    assert.equal(load.kind, "loaded");
    if (load.kind !== "loaded") return;
    assert.match(load.invalid["missing-client"] ?? "", /clientRef/);
    assert.match(load.invalid["cli-client"] ?? "", /clientRef/);
    assert.match(load.invalid["bad-kind"] ?? "", /kind/);
    assert.match(load.invalid["mixed-channels"] ?? "", /同时声明|互斥/);
    assert.match(load.invalid.chained ?? "", /直接持有|链式/);
    assert.match(load.invalid["missing-source"] ?? "", /来源|channelsFrom/);
    assert.equal(
      resolveLiveTargets(load, { carrier: "missing-source" }).kind,
      "not-configured",
    );
  } finally {
    await cleanup();
  }
});
