/**
 * @module @x-agent-suite/llm-fixture/tests/live-config-sources
 * provider-less 宿主的逻辑 provider 与凭据绑定测试。
 * 不变量：临时目录、注入借用钩子与合成凭据，零网络、零 token。
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { stringify as stringifyYaml } from "yaml";
import {
  loadLiveConfig,
  resolveLiveCredential,
  resolveLiveTargets,
} from "@x-agent-suite/llm-fixture";

/** 写入隔离 carriers 配置。 */
async function writeConfig(
  root: string,
  carriers: Record<string, unknown>,
): Promise<string> {
  const repoRoot = join(root, "repo");
  const path = join(repoRoot, ".env.e2e.yaml");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, stringifyYaml({ carriers }), "utf8");
  return repoRoot;
}

/** 创建测试临时目录。 */
async function makeRoot(): Promise<string> {
  return mkdtemp(join(os.tmpdir(), "xas-live-sources-"));
}

test("provider-less 宿主：逻辑 provider 键不视为端点覆盖，凭据仍绑定借用渠道", async () => {
  const root = await makeRoot();
  try {
    const repoRoot = await writeConfig(root, {
      "carrier-a": {
        from: "harness",
        providers: { logical: { models: ["model-a"] } },
        default: "model-a",
      },
    });
    const borrowChannel = async () => ({
      kind: "resolved" as const,
      wire: "openai-chat" as const,
      baseUrl: "https://provider-less.example.com/v1",
      source: "synthetic",
    });
    const load = await loadLiveConfig({
      env: {},
      repoRoot,
      homeDir: join(root, "home"),
      borrowChannel,
    });
    assert.equal(load.kind, "loaded");
    if (load.kind !== "loaded") return;
    assert.equal(load.invalid["carrier-a"], undefined);
    const selected = resolveLiveTargets(load, { carrier: "carrier-a" });
    assert.equal(selected.kind, "configured");
    if (selected.kind !== "configured") return;
    assert.equal(selected.targets[0]?.channel.provider, "logical");

    const credential = await resolveLiveCredential(
      selected.targets[0]!.channel,
      {
        carrier: "carrier-a",
        env: {},
        homeDir: join(root, "home"),
        borrowChannel,
        borrowCredential: async () => ({
          kind: "resolved" as const,
          apiKey: "synthetic-provider-less-key",
          source: "synthetic",
        }),
      },
    );
    assert.equal(credential.kind, "resolved");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
