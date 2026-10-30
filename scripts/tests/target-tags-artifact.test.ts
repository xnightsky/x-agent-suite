/**
 * @module scripts/tests/target-tags-artifact
 * 验证 TargetTags 在源码和模拟安装布局中的资源定位、显式覆盖及 Judge 准入。
 * 不变量：只构建通用模块、读取公共 YAML；不启动宿主、不读私密配置、零 token。
 */
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import type { createJudgeClient } from "@x-agent-suite/judge";
import type { ResolvedLiveTarget } from "@x-agent-suite/llm-fixture";
import { loadTargetTagCatalog } from "@x-agent-suite/llm-fixture";
import { createCorePackageManifest } from "../artifacts-package.ts";

const ROOT = resolve(import.meta.dirname, "../..");
let stage: string;
let packageRoot: string;
let customRoot: string;
let loadInstalled: typeof loadTargetTagCatalog;
let createInstalledJudgeClient: typeof createJudgeClient;

before(async () => {
  stage = await mkdtemp(join(tmpdir(), "xas-target-tags-artifact-"));
  packageRoot = join(stage, "consumer/node_modules/@xnightsky/x-agent-suite");
  customRoot = join(stage, "custom");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(
    join(packageRoot, "package.json"),
    JSON.stringify({
      ...createCorePackageManifest("0.7.0"),
      name: "@xnightsky/x-agent-suite",
    }),
  );
  await cp(
    join(ROOT, "config/target-tags"),
    join(packageRoot, "config/target-tags"),
    {
      recursive: true,
    },
  );
  await writeCustomCatalog(customRoot);
  await writeCustomCatalog(join(stage, "consumer"));
  const outdir = join(packageRoot, "dist");
  await build({
    entryPoints: [
      join(ROOT, "packaging/entries/llm-fixture.ts"),
      join(ROOT, "packaging/entries/judge.ts"),
    ],
    outdir,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    banner: {
      js: 'import { createRequire as __xasCreateRequire } from "node:module"; const require = __xasCreateRequire(import.meta.url);',
    },
  });
  ({ loadTargetTagCatalog: loadInstalled } = await import(
    pathToFileURL(join(outdir, "llm-fixture.js")).href
  ));
  ({ createJudgeClient: createInstalledJudgeClient } = await import(
    pathToFileURL(join(outdir, "judge.js")).href
  ));
});

after(async () => {
  if (stage) await rm(stage, { recursive: true, force: true });
});

async function writeCustomCatalog(root: string): Promise<void> {
  const directory = join(root, "config/target-tags");
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(join(directory, "keys.yaml"), "version: 1\nkeys: []\n"),
    writeFile(join(directory, "instances.yaml"), "version: 1\n"),
  ]);
}

test("源码默认加载与显式 repoRoot 一致", async () => {
  assert.deepEqual(
    await loadTargetTagCatalog(),
    await loadTargetTagCatalog({ repoRoot: ROOT }),
  );
});

test("安装布局默认使用包内公共资源，不读取消费者同名目录", async () => {
  const catalog = await loadInstalled();
  assert.ok(catalog.dictionary.keys.length > 0);
  assert.deepEqual(catalog, await loadTargetTagCatalog({ repoRoot: ROOT }));
});

test("安装布局保留 repoRoot 与单文件路径的显式覆盖优先级", async () => {
  // homeDir 隔离到 stage：本机 home 的全局实例不干扰空词典解析。
  const custom = await loadInstalled({ repoRoot: customRoot, homeDir: stage });
  assert.deepEqual(custom.dictionary.keys, []);
  const explicit = await loadInstalled({
    repoRoot: ROOT,
    homeDir: stage,
    dictionaryPath: join(customRoot, "config/target-tags/keys.yaml"),
    instancesPath: join(customRoot, "config/target-tags/instances.yaml"),
  });
  assert.deepEqual(explicit, custom);
  const mixed = await loadInstalled({
    homeDir: stage,
    instancesPath: join(customRoot, "config/target-tags/instances.yaml"),
  });
  assert.ok(mixed.dictionary.keys.length > 0);
  assert.deepEqual(mixed.instances.providers, []);
});

test("包内资源缺失显式失败，不回退到消费者或源码仓", async () => {
  const path = join(packageRoot, "config/target-tags/keys.yaml");
  await rename(path, `${path}.backup`);
  try {
    await assert.rejects(loadInstalled(), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, "TargetTagDefinitionError");
      assert.ok(error.message.includes(path));
      assert.equal((error.cause as NodeJS.ErrnoException).code, "ENOENT");
      return true;
    });
  } finally {
    await rename(`${path}.backup`, path);
  }
});

test("打包 Judge 公开入口接受本次获批的 API-credit borrowed 候选", async (t) => {
  const { dictionary } = await loadTargetTagCatalog({
    repoRoot: ROOT,
    homeDir: stage,
  });
  const target = {
    carrier: "fixture-carrier",
    channel: {
      wire: "openai-chat",
      baseUrl: "https://fixture.invalid/v1",
      provider: "fixture-provider",
      model: "fixture-model",
    },
  } satisfies ResolvedLiveTarget;
  let factoryCalls = 0;
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("NETWORK_FORBIDDEN");
  });
  const client = createInstalledJudgeClient({
    target,
    mode: "borrowed",
    liveReviewApproved: true,
    tags: {
      dictionary,
      instances: {
        cli: [
          {
            id: "fixture-cli",
            carrier: target.carrier,
            wires: [target.channel.wire],
            tags: [
              "cli.execution.one-shot",
              "cli.execution.unattended",
              "cli.session.ephemeral",
              "cli.context.context-files.off",
              "cli.context.extensions.off",
              "cli.context.skills.off",
              "cli.tools.none",
              "cli.io.text",
            ],
          },
        ],
        providers: [
          {
            id: target.channel.provider,
            tags: [
              "provider.usage.api-credit",
              "provider.usage.live.review-required",
            ],
          },
        ],
        providerModels: [
          {
            id: "fixture-provider/fixture-model",
            providerRef: target.channel.provider,
            model: target.channel.model,
            modelRef: "fixture-canonical",
            wire: target.channel.wire,
            tags: ["provider-model.api.complete"],
          },
        ],
        models: [{ id: "fixture-canonical", tags: ["model.inference.chat"] }],
      },
    },
    createDriver: () => {
      factoryCalls += 1;
      throw new Error("工厂选择阶段不得创建 driver");
    },
  });
  assert.equal(client.mode, "borrowed");
  assert.equal(client.cliRef, "fixture-cli");
  assert.equal(factoryCalls, 0);
});
