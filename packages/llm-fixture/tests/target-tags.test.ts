/**
 * @module @x-agent-suite/llm-fixture/tests/target-tags
 * TargetTags 词典、真实实例与 direct/borrowed/live 决策测试。
 * 不变量：不读取真实 home 配置，不发起网络请求，零 token。
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  decideLiveTarget,
  decideLiveTargets,
  loadTargetTagCatalog,
  parseTargetTagDictionary,
  parseTargetTagInstances,
  type LiveChannel,
  type LiveConfigLoad,
  type LiveTargetDecision,
  type TargetDecisionOptions,
  type TargetTagCatalog,
  type TargetTagDictionary,
} from "@x-agent-suite/llm-fixture";

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

const DICTIONARY_YAML = `
version: 1
keys:
  - { key: cli.execution, scope: cli, dimension: execution, status: maintained, values: [one-shot, unattended] }
  - { key: cli.session, scope: cli, dimension: session, status: maintained, values: [ephemeral] }
  - { key: cli.context, scope: cli, dimension: context, status: maintained, values: [context-files.off, extensions.off, skills.off] }
  - { key: cli.tools, scope: cli, dimension: tools, status: maintained, values: [none, allowlist] }
  - { key: cli.io, scope: cli, dimension: io, status: maintained, values: [text] }
  - { key: provider.usage, scope: provider, dimension: usage, status: maintained, values: [api-payg, api-credit, api-free, cli-subscription, ci-subscription, third-party-subscription, cli-free, live.allowed, live.review-required, live.disallowed] }
  - { key: provider-model.api, scope: provider-model, dimension: api, status: maintained, values: [complete] }
  - { key: provider-model.usage, scope: provider-model, dimension: usage, status: maintained, values: [api-payg, api-credit, api-free, cli-subscription, ci-subscription, third-party-subscription, cli-free, live.allowed, live.review-required, live.disallowed] }
  - { key: model.inference, scope: model, dimension: inference, status: maintained, values: [chat] }
  - { key: cli.approval, scope: cli, dimension: approval, status: reserved, values: [] }
`;

const INSTANCES_YAML = `
version: 1
cli:
  - id: cli-clean
    carrier: carrier-a
    wires: [openai-chat]
    tags: [cli.execution.one-shot, cli.execution.unattended, cli.session.ephemeral, cli.context.context-files.off, cli.context.extensions.off, cli.context.skills.off, cli.tools.none, cli.tools.allowlist, cli.io.text]
providers:
  - id: provider-a
    tags: [provider.usage.api-payg, provider.usage.third-party-subscription, provider.usage.live.allowed]
providerModels:
  - id: provider-model-a
    providerRef: provider-a
    model: model-alias
    modelRef: canonical-a
    wire: openai-chat
    tags: [provider-model.api.complete]
models:
  - id: canonical-a
    tags: [model.inference.chat]
`;

const REQUIREMENTS: TargetDecisionOptions["requirements"] = {
  direct: {
    allOf: ["provider-model.api.complete", "model.inference.chat"],
    anyOf: [
      [
        "provider-model.usage.api-payg",
        "provider-model.usage.api-credit",
        "provider-model.usage.api-free",
      ],
    ],
  },
  borrowed: {
    allOf: [
      "cli.execution.one-shot",
      "cli.execution.unattended",
      "cli.session.ephemeral",
      "cli.context.context-files.off",
      "cli.context.extensions.off",
      "cli.context.skills.off",
      "cli.tools.none",
      "cli.io.text",
      "model.inference.chat",
    ],
    anyOf: [
      [
        "provider-model.usage.cli-subscription",
        "provider-model.usage.ci-subscription",
        "provider-model.usage.third-party-subscription",
        "provider-model.usage.cli-free",
      ],
    ],
  },
};

function syntheticCatalog(instancesYaml = INSTANCES_YAML): TargetTagCatalog {
  const dictionary = parseTargetTagDictionary(DICTIONARY_YAML);
  return {
    dictionary,
    instances: parseTargetTagInstances(instancesYaml, dictionary),
  };
}
function withoutLayer(
  catalog: TargetTagCatalog,
  layer: "providers" | "providerModels",
): TargetTagCatalog {
  return {
    ...catalog,
    instances: { ...catalog.instances, [layer]: [] },
  };
}

function liveLoad(
  channel: {
    carrier?: string;
    provider?: string;
    model?: string;
    wire?: LiveChannel["wire"];
  } = {},
): LiveConfigLoad {
  const carrier = channel.carrier ?? "carrier-a";
  const resolved = {
    wire: channel.wire ?? "openai-chat",
    baseUrl: "https://example.invalid/v1",
    provider: channel.provider ?? "provider-a",
    model: channel.model ?? "model-alias",
  } as const;
  return {
    kind: "loaded",
    source: "explicit-path",
    path: "/synthetic/live.yaml",
    channels: { [carrier]: resolved },
    available: { [carrier]: [resolved] },
    defaults: { [carrier]: [resolved] },
    invalid: {},
    warnings: [],
  };
}

function firstDecision(
  catalog: TargetTagCatalog,
  options: Partial<TargetDecisionOptions> = {},
  load: LiveConfigLoad = liveLoad(),
): LiveTargetDecision {
  const result = decideLiveTargets(load, catalog, {
    requirements: REQUIREMENTS,
    ...options,
  });
  if (result.kind !== "configured") throw new Error(result.reason);
  assert.equal(result.decisions.length, 1);
  return result.decisions[0]!;
}

function withLivePolicy(
  providerLive?: string,
  providerModelLive?: string,
): string {
  const providerTags = [
    "provider.usage.api-payg",
    "provider.usage.third-party-subscription",
  ];
  if (providerLive) providerTags.push(`provider.usage.${providerLive}`);
  const providerModelTags = ["provider-model.api.complete"];
  if (providerModelLive)
    providerModelTags.push(`provider-model.usage.${providerModelLive}`);
  return INSTANCES_YAML.replace(
    "tags: [provider.usage.api-payg, provider.usage.third-party-subscription, provider.usage.live.allowed]",
    `tags: [${providerTags.join(", ")}]`,
  ).replace(
    "tags: [provider-model.api.complete]",
    `tags: [${providerModelTags.join(", ")}]`,
  );
}

test("正式 YAML：四层真实实例可加载，k3 与 kimi-for-coding 不共享 canonical identity", async () => {
  const catalog = await loadTargetTagCatalog({ repoRoot: REPO_ROOT });
  assert.ok(
    !catalog.instances.providers.some((provider) => provider.id === "co"),
  );
  const pi = catalog.instances.cli.find((instance) => instance.id === "pi");
  assert.ok(pi);
  for (const tag of [
    "cli.context.context-files.off",
    "cli.context.extensions.off",
    "cli.context.skills.off",
    "cli.tools.allowlist",
  ]) {
    assert.ok(pi.tags.includes(tag), tag);
  }
  assert.ok(!pi.tags.includes("cli.context.resources.off"));
  const k3 = catalog.instances.models.find((model) => model.id === "k3");
  const coding = catalog.instances.models.find(
    (model) => model.id === "kimi-for-coding",
  );
  assert.ok(k3?.tags.includes("model.inference.chat"));
  assert.ok(k3?.tags.includes("model.inference.reasoning"));
  assert.ok(coding?.tags.includes("model.inference.chat"));
  assert.notEqual(k3, coding);
  const k3ProviderModel = catalog.instances.providerModels.find(
    (instance) => instance.id === "kimi-coding/k3",
  );
  assert.equal(k3ProviderModel?.modelRef, "k3");
  const codingProviderModel = catalog.instances.providerModels.find(
    (instance) => instance.id === "kimi-coding/kimi-for-coding",
  );
  assert.equal(codingProviderModel?.modelRef, "kimi-for-coding");
  const codingAnthropic = catalog.instances.providerModels.find(
    (instance) => instance.id === "kimi-coding/kimi-for-coding-anthropic",
  );
  assert.equal(codingAnthropic?.modelRef, "kimi-for-coding");
  assert.equal(codingAnthropic?.wire, "anthropic-messages");
});
test("私密 targetTags：合并私有实例和账号策略，不带出 carriers 或凭据", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "xas-target-tags-"));
  try {
    const path = join(root, "live.yaml");
    await writeFile(
      path,
      `carriers:
  private:
    apiKey: synthetic-secret
targetTags:
  version: 1
  providers:
    - { id: kimi-coding, tags: [provider.usage.third-party-subscription, provider.usage.live.review-required] }
    - { id: private-provider, tags: [provider.usage.api-payg, provider.usage.live.allowed] }
  providerModels:
    - id: kimi-coding/kimi-for-coding
      providerRef: kimi-coding
      model: kimi-for-coding
      tags: [provider-model.usage.third-party-subscription]
    - id: private-provider/model-alias
      providerRef: private-provider
      model: model-alias
      modelRef: private-canonical
      wire: openai-chat
      tags: [provider-model.api.complete]
  models:
    - { id: private-canonical, tags: [model.inference.chat] }
`,
      "utf8",
    );
    const load = liveLoad();
    assert.equal(load.kind, "loaded");
    if (load.kind !== "loaded") return;
    const catalog = await loadTargetTagCatalog({
      repoRoot: REPO_ROOT,
      liveConfig: { ...load, path },
    });
    const providers = catalog.instances.providers.filter(
      ({ id }) => id === "kimi-coding",
    );
    assert.equal(providers.length, 1);
    assert.ok(
      providers[0]?.tags.includes("provider.usage.live.review-required"),
    );
    const refined = catalog.instances.providerModels.find(
      ({ id }) => id === "kimi-coding/kimi-for-coding",
    );
    assert.equal(refined?.modelRef, "kimi-for-coding");
    assert.equal(refined?.wire, "openai-chat");
    assert.ok(
      refined?.tags.includes("provider-model.usage.third-party-subscription"),
    );
    assert.ok(
      catalog.instances.providers.some(({ id }) => id === "private-provider"),
    );
    assert.ok(
      catalog.instances.providerModels.some(
        ({ modelRef }) => modelRef === "private-canonical",
      ),
    );
    assert.ok(!JSON.stringify(catalog).includes("synthetic-secret"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("实例校验：reserved、跨 scope、秘密字段与悬空 modelRef 均显式失败", () => {
  const dictionary: TargetTagDictionary =
    parseTargetTagDictionary(DICTIONARY_YAML);
  const parse = (yaml: string) => () =>
    parseTargetTagInstances(yaml, dictionary);
  assert.throws(
    parse(INSTANCES_YAML.replace("cli.io.text", "cli.approval")),
    /reserved|预留/,
  );
  assert.throws(
    parse(INSTANCES_YAML.replace("cli.io.text", "model.inference.chat")),
    /scope|作用域/,
  );
  assert.throws(
    parse(
      INSTANCES_YAML.replace(
        "carrier: carrier-a",
        "carrier: carrier-a\n    apiKey: forbidden",
      ),
    ),
    /apiKey|未知字段/,
  );
  assert.throws(
    parse(
      INSTANCES_YAML.replace(
        "modelRef: canonical-a",
        "modelRef: missing-model",
      ),
    ),
    /modelRef|引用/,
  );
});

test("决策：provider 默认 usage 生效，单 target 双模式同时满足时返回全部候选", () => {
  const load = liveLoad();
  assert.equal(load.kind, "loaded");
  if (load.kind !== "loaded") return;
  const decision = decideLiveTarget(
    { carrier: "carrier-a", channel: load.channels["carrier-a"]! },
    syntheticCatalog(),
    { requirements: REQUIREMENTS },
  );
  assert.equal(decision.live.status, "allowed");
  assert.equal(decision.live.allowed, true);
  assert.deepEqual(
    new Set(decision.candidates.map(({ mode }) => mode)),
    new Set(["direct", "borrowed"]),
  );
  assert.ok(decision.candidates.every(({ allowed }) => allowed));
});

test("决策：direct 不依赖 CliTags，borrowed 缺 CLI 能力时不允许", () => {
  const yaml = INSTANCES_YAML.replace("cli.session.ephemeral, ", "").replace(
    "cli.tools.none, ",
    "",
  );
  const decision = firstDecision(syntheticCatalog(yaml));
  assert.deepEqual(
    decision.candidates.map(({ mode }) => mode),
    ["direct"],
  );
  const borrowed = decision.evaluations.find(({ mode }) => mode === "borrowed");
  assert.deepEqual(borrowed?.missingGroups, [
    ["cli.session.ephemeral"],
    ["cli.tools.none"],
  ]);
  assert.equal(borrowed?.allowed, false);
});

test("决策：borrowed 必须同时通过 CLI 与 ProviderModel 的 wire 兼容检查", () => {
  const decision = firstDecision(
    syntheticCatalog(
      INSTANCES_YAML.replace(
        "wires: [openai-chat]",
        "wires: [openai-responses]",
      ),
    ),
  );
  assert.deepEqual(
    decision.candidates.map(({ mode }) => mode),
    ["direct"],
  );
  const borrowed = decision.evaluations.find(({ mode }) => mode === "borrowed");
  assert.match(borrowed?.issues.join(" ") ?? "", /wire/);
});

test("live 策略：disallowed 优先，review-required 仅本次显式批准可放行", () => {
  const disallowed = firstDecision(
    syntheticCatalog(withLivePolicy("live.allowed", "live.disallowed")),
    { liveReviewApproved: true },
  );
  assert.equal(disallowed.live.status, "disallowed");
  assert.equal(disallowed.candidates.length, 0);

  const reviewCatalog = syntheticCatalog(
    withLivePolicy("live.allowed", "live.review-required"),
  );
  const unapproved = firstDecision(reviewCatalog);
  assert.equal(unapproved.live.status, "review-required");
  assert.equal(unapproved.candidates.length, 0);
  const approved = firstDecision(reviewCatalog, { liveReviewApproved: true });
  assert.equal(approved.live.allowed, true);
  assert.equal(approved.candidates.length, 2);
});
test("live 策略：缺层不掩盖另一层 disallowed/review-required", () => {
  for (const status of ["disallowed", "review-required"] as const) {
    const withoutProvider = withoutLayer(
      syntheticCatalog(withLivePolicy(undefined, `live.${status}`)),
      "providers",
    );
    assert.equal(firstDecision(withoutProvider).live.status, status);

    const withoutProviderModel = withoutLayer(
      syntheticCatalog(withLivePolicy(`live.${status}`)),
      "providerModels",
    );
    assert.equal(firstDecision(withoutProviderModel).live.status, status);
  }
});

test("live 策略：unknown 与 allowed 区分，非 live 判断不被 live 门禁覆盖", () => {
  const unknown = firstDecision(syntheticCatalog(withLivePolicy()));
  assert.equal(unknown.live.status, "unknown");
  assert.equal(unknown.live.allowed, false);
  assert.equal(unknown.candidates.length, 0);
  const fixtureOnly = firstDecision(syntheticCatalog(withLivePolicy()), {
    live: false,
  });
  assert.equal(fixtureOnly.live.status, "unknown");
  assert.equal(fixtureOnly.candidates.length, 2);

  const allowed = firstDecision(
    syntheticCatalog(withLivePolicy("live.allowed")),
  );
  assert.equal(allowed.live.status, "allowed");
  assert.equal(allowed.candidates.length, 2);
});

test("正式实例：真实 target 的 usage/live 未声明时保持 unknown 且不放行", async () => {
  const catalog = await loadTargetTagCatalog({ repoRoot: REPO_ROOT });
  const decision = firstDecision(
    catalog,
    {},
    liveLoad({
      carrier: "pi",
      provider: "kimi-coding",
      model: "kimi-for-coding",
    }),
  );
  assert.equal(decision.live.status, "unknown");
  assert.equal(decision.live.allowed, false);
  assert.equal(decision.candidates.length, 0);
  assert.ok(decision.evaluations.every(({ allowed }) => !allowed));
});

test("target 解析失败保持 not-configured，不生成第二套模型选择逻辑", () => {
  const result = decideLiveTargets(liveLoad(), syntheticCatalog(), {
    selection: { model: "missing" },
    requirements: REQUIREMENTS,
  });
  assert.equal(result.kind, "not-configured");
});
