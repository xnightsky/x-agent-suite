/**
 * @module @x-agent-suite/llm-fixture/tests/target-tags-home
 * home 私有实例与当前 live overlay 的分层合并契约测试。
 * 不变量：临时 home、合成端点、零真实 home 读取、零网络、零 token。
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { stringify } from "yaml";
import {
  decideLiveTarget,
  loadTargetTagCatalog,
  type LiveConfigLoad,
} from "@x-agent-suite/llm-fixture";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

test("home 私有实例位于公共目录与 live overlay 之间且 live 策略不放松", async (t) => {
  const root = await mkdtemp(join(os.tmpdir(), "xas-target-tags-home-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const homeDir = join(root, "home");
  await mkdir(homeDir, { recursive: true });
  const instancesPath = join(root, "public-instances.yaml");
  await writeFile(
    instancesPath,
    stringify({
      version: 1,
      providers: [{ id: "co", tags: [] }],
    }),
  );
  await writeFile(
    join(homeDir, ".env.target-tags.instances.yaml"),
    stringify({
      version: 1,
      providers: [
        {
          id: "co",
          tags: [
            "provider.usage.api-credit",
            "provider.usage.live.review-required",
          ],
        },
      ],
      providerModels: [
        {
          id: "co/model-a",
          providerRef: "co",
          model: "model-a",
          modelRef: "model-a",
          wire: "openai-chat",
          tags: ["provider-model.api.complete"],
        },
      ],
      models: [{ id: "model-a", tags: ["model.inference.chat"] }],
    }),
  );
  const livePath = join(root, "live.yaml");
  await writeFile(
    livePath,
    stringify({
      targetTags: {
        version: 1,
        providers: [
          {
            id: "co",
            tags: [
              "provider.usage.api-payg",
              "provider.usage.live.allowed",
            ],
          },
        ],
      },
    }),
  );
  const liveConfig: LiveConfigLoad = {
    kind: "loaded",
    source: "explicit-path",
    path: livePath,
    channels: {},
    available: {},
    defaults: {},
    invalid: {},
    warnings: [],
  };

  const catalog = await loadTargetTagCatalog({
    repoRoot: REPO_ROOT,
    instancesPath,
    homeDir,
    liveConfig,
  });
  const provider = catalog.instances.providers.find(({ id }) => id === "co");
  assert.deepEqual(
    new Set(provider?.tags),
    new Set([
      "provider.usage.api-credit",
      "provider.usage.live.review-required",
      "provider.usage.api-payg",
      "provider.usage.live.allowed",
    ]),
  );
  const target = {
    carrier: "ephemeral-co",
    kind: "ephemeral-client",
    clientRef: "ephemeral-client",
    channel: {
      wire: "openai-chat",
      baseUrl: "https://target-tags.invalid/v1",
      provider: "co",
      model: "model-a",
    },
  } as const;
  const requirements = {
    direct: {
      allOf: ["provider-model.api.complete", "model.inference.chat"],
      anyOf: [[
        "provider-model.usage.api-payg",
        "provider-model.usage.api-credit",
        "provider-model.usage.api-free",
      ]],
    },
    borrowed: { allOf: [] },
  } as const;
  const denied = decideLiveTarget(target, catalog, {
    requirements,
    liveReviewApproved: false,
  });
  assert.equal(denied.live.status, "review-required");
  assert.equal(denied.live.allowed, false);
  const approved = decideLiveTarget(target, catalog, {
    requirements,
    liveReviewApproved: true,
  });
  assert.equal(approved.live.allowed, true);
  assert.equal(
    approved.evaluations.find(({ mode }) => mode === "direct")?.allowed,
    true,
  );
});
