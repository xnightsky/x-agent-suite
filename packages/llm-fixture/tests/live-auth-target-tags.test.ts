/**
 * @module @x-agent-suite/llm-fixture/tests/live-auth-target-tags
 * TargetTags 与可选认证文件的独立性测试。
 * 不变量：损坏认证文件也不得影响 catalog；不读取真实 home，零网络。
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  loadTargetTagCatalog,
  type LiveConfigLoad,
} from "@x-agent-suite/llm-fixture";

test("TargetTagCatalog 不读取认证文件且不生成 auth 标签", async (t) => {
  const root = await mkdtemp(join(os.tmpdir(), "xas-auth-tags-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, ".env.e2e.yaml");
  await writeFile(path, `targetTags:
  version: 1
  providers: []
`);
  await writeFile(join(root, ".env.auth.yaml"), "version: 1\nproviders: [\n");
  const channel = {
    wire: "openai-chat",
    baseUrl: "https://example.invalid/v1",
    provider: "provider-a",
    model: "model-a",
  } as const;
  const liveConfig: LiveConfigLoad = {
    kind: "loaded",
    source: "repo-local",
    path,
    channels: { "carrier-a": channel },
    available: { "carrier-a": [channel] },
    defaults: { "carrier-a": [channel] },
    invalid: {},
    warnings: [],
  };

  const catalog = await loadTargetTagCatalog({ liveConfig });
  const tags = [
    ...catalog.instances.cli,
    ...catalog.instances.providers,
    ...catalog.instances.providerModels,
    ...catalog.instances.models,
  ].flatMap((item) => item.tags);
  assert.equal(tags.some((tag) => tag.includes(".auth.")), false);
});
