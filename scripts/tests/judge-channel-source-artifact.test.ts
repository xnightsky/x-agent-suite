/**
 * @module scripts/tests/judge-channel-source-artifact
 * 公开打包 Judge 的渠道借用来源与执行归因回归。
 * 不变量：只用合成 target/hooks/driver/transport；隔离配置、零真实凭据、零网络、零 token。
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import type { AgentDriver } from "@x-agent-suite/contracts";
import type {
  LiveBackend,
  LiveConfigOptions,
  ResolvedLiveTarget,
  TargetTagCatalog,
} from "@x-agent-suite/llm-fixture";

const ROOT = resolve(import.meta.dirname, "../..");
const INPUT = {
  output: "answer",
  rubrics: [{ name: "grounded", rubric: "回答是否基于证据" }],
} as const;
const CLEAN_CLI_TAGS = [
  "cli.execution.one-shot",
  "cli.execution.unattended",
  "cli.session.ephemeral",
  "cli.context.context-files.off",
  "cli.context.extensions.off",
  "cli.context.skills.off",
  "cli.tools.none",
  "cli.io.text",
] as const;

type BorrowBehavior = "ok" | "missing" | "mismatch";

let stage: string;
let judgeApi: typeof import("@x-agent-suite/judge");
let dictionary: TargetTagCatalog["dictionary"];

before(async () => {
  await mkdir(join(ROOT, ".tmp"), { recursive: true });
  stage = await mkdtemp(join(ROOT, ".tmp", "xas-judge-channel-source-"));
  const entries = {
    judge: join(ROOT, "packaging/entries/judge.ts"),
    "llm-fixture": join(ROOT, "packaging/entries/llm-fixture.ts"),
  };
  const outdir = join(stage, "dist");
  await build({
    absWorkingDir: ROOT,
    entryPoints: entries,
    alias: {
      "@x-agent-suite/judge": entries.judge,
      "@x-agent-suite/llm-fixture": entries["llm-fixture"],
    },
    outdir,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    sourcemap: true,
    banner: {
      js: 'import { createRequire as __xasCreateRequire } from "node:module"; const require = __xasCreateRequire(import.meta.url);',
    },
  });
  [judgeApi] = await Promise.all([
    import(pathToFileURL(join(outdir, "judge.js")).href),
  ]);
  const fixtureApi = await import(
    pathToFileURL(join(outdir, "llm-fixture.js")).href
  );
  dictionary = (
    await fixtureApi.loadTargetTagCatalog({ repoRoot: ROOT, homeDir: stage })
  ).dictionary;
});

after(async () => {
  if (stage) await rm(stage, { recursive: true, force: true });
});

/** 构造借用渠道的执行目标；channel.harness 可显式覆盖借用宿主。 */
function makeTarget(
  channelCarrier?: string,
  harness?: string,
): ResolvedLiveTarget {
  return {
    carrier: "exec-carrier",
    ...(channelCarrier ? { channelCarrier } : {}),
    channel: {
      wire: "openai-chat",
      baseUrl: "https://source.invalid/v1",
      provider: "fixture-provider",
      model: "fixture-model",
      from: "harness",
      credential: "harness",
      ...(harness ? { harness } : {}),
    },
  };
}

/** 为目标构造唯一 borrowed/direct 均可评估的合成目录。 */
function catalogFor(target: ResolvedLiveTarget): TargetTagCatalog {
  return {
    dictionary,
    instances: {
      cli: [
        {
          id: "fixture-cli",
          carrier: target.carrier,
          wires: [target.channel.wire],
          tags: [...CLEAN_CLI_TAGS],
        },
      ],
      providers: [
        {
          id: "fixture-provider",
          tags: ["provider.usage.api-credit", "provider.usage.live.allowed"],
        },
      ],
      providerModels: [
        {
          id: "fixture-provider/fixture-model",
          providerRef: "fixture-provider",
          model: target.channel.model,
          modelRef: "fixture-canonical",
          wire: target.channel.wire,
          tags: ["provider-model.api.complete"],
        },
      ],
      models: [{ id: "fixture-canonical", tags: ["model.inference.chat"] }],
    },
  };
}

/** 创建记录借用来源的合成 hooks；端点缺失或不匹配在凭据前显式失败。 */
function createHooks(target: ResolvedLiveTarget, behavior: BorrowBehavior) {
  const channelCalls: string[] = [];
  const credentialCalls: string[] = [];
  const config: LiveConfigOptions = {
    env: {},
    repoRoot: stage,
    homeDir: stage,
    borrowChannel: async (carrier) => {
      channelCalls.push(carrier);
      if (behavior === "missing") {
        return { kind: "missing", reason: "synthetic source missing" };
      }
      return {
        kind: "resolved",
        wire: target.channel.wire,
        baseUrl:
          behavior === "mismatch"
            ? "https://mismatch.invalid/v1"
            : target.channel.baseUrl,
        provider: target.channel.provider,
        model: target.channel.model,
        source: "synthetic",
      };
    },
    borrowCredential: async (carrier) => {
      credentialCalls.push(carrier);
      return {
        kind: "resolved",
        apiKey: "synthetic-secret",
        source: "synthetic",
      };
    },
  };
  return { config, channelCalls, credentialCalls };
}

/** fake driver 经 backend.start 兑现真实借用流程，并在 close 停止 backend。 */
function createDriver(backend: LiveBackend, log: string[]): AgentDriver {
  return {
    async start() {
      log.push("start");
      await backend.start();
    },
    async sendPrompt() {
      log.push("send");
      return {
        text: '{"grounded":true}',
        toolCalls: [],
        toolCallsCount: 0,
        events: [],
      };
    },
    events: async function* () {},
    async close() {
      log.push("close");
      await backend.stop();
    },
  };
}

/** 经公开 borrowed 工厂和 judge() 执行合成目标。 */
async function runBorrowed(
  target: ResolvedLiveTarget,
  behavior: BorrowBehavior = "ok",
) {
  const hooks = createHooks(target, behavior);
  const log: string[] = [];
  const backendCarriers: string[] = [];
  const client = judgeApi.createJudgeClient({
    target,
    tags: catalogFor(target),
    mode: "borrowed",
    config: hooks.config,
    createDriver: ({ backend }) => {
      backendCarriers.push(backend.carrier);
      return createDriver(backend, log);
    },
  });
  const outcome = await judgeApi.judge(INPUT, { client, maxRetries: 0 });
  return { client, outcome, log, backendCarriers, ...hooks };
}

/** 经公开 direct 工厂和 fake transport 执行合成目标。 */
async function runDirect(
  target: ResolvedLiveTarget,
  behavior: BorrowBehavior = "ok",
) {
  const hooks = createHooks(target, behavior);
  let transportCalls = 0;
  const client = judgeApi.createJudgeClient({
    target,
    tags: catalogFor(target),
    mode: "direct",
    config: hooks.config,
    transport: async () => {
      transportCalls += 1;
      return {
        status: 200,
        text: JSON.stringify({
          choices: [{ message: { content: '{"grounded":true}' } }],
        }),
      };
    },
  });
  const outcome = await judgeApi.judge(INPUT, { client, maxRetries: 0 });
  return { client, outcome, transportCalls, ...hooks };
}

test("borrowed 借用锚定 channelCarrier，显式 harness 优先且执行归因不变", async (t) => {
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("NETWORK_FORBIDDEN");
  });
  for (const [target, backendCarrier, borrowSource] of [
    [makeTarget(), "exec-carrier", "exec-carrier"],
    [makeTarget("source-carrier"), "source-carrier", "source-carrier"],
    [
      makeTarget("source-carrier", "explicit-harness"),
      "source-carrier",
      "explicit-harness",
    ],
  ] as const) {
    const result = await runBorrowed(target);
    assert.equal(result.outcome.status, "completed");
    assert.deepEqual(result.channelCalls, [borrowSource]);
    assert.deepEqual(result.credentialCalls, [borrowSource]);
    assert.deepEqual(result.backendCarriers, [backendCarrier]);
    assert.deepEqual(result.log, ["start", "send", "close"]);
    assert.equal(result.client.target, target);
    assert.equal(result.client.target.carrier, "exec-carrier");
    assert.equal(result.client.target.channelCarrier, target.channelCarrier);
  }
});

test("borrowed 来源缺失或端点不一致在发送前拒绝并清理", async (t) => {
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("NETWORK_FORBIDDEN");
  });
  for (const behavior of ["missing", "mismatch"] as const) {
    const target = makeTarget("source-carrier");
    const result = await runBorrowed(target, behavior);
    assert.equal(result.outcome.status, "not-evaluated");
    if (result.outcome.status === "not-evaluated") {
      assert.equal(result.outcome.failure.kind, "not-configured");
      assert.equal(result.outcome.attempts, 1);
    }
    assert.deepEqual(result.channelCalls, ["source-carrier"]);
    assert.deepEqual(result.credentialCalls, []);
    assert.deepEqual(result.log, ["start", "close"]);
    assert.equal(result.client.mode, "borrowed");
  }
});

test("direct 共用 backend 的来源语义一致，拒绝时不发请求", async (t) => {
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("NETWORK_FORBIDDEN");
  });
  const target = makeTarget("source-carrier");
  const success = await runDirect(target);
  assert.equal(success.outcome.status, "completed");
  assert.deepEqual(success.channelCalls, ["source-carrier"]);
  assert.deepEqual(success.credentialCalls, ["source-carrier"]);
  assert.equal(success.transportCalls, 1);
  assert.equal(success.client.target, target);

  for (const behavior of ["missing", "mismatch"] as const) {
    const rejected = await runDirect(target, behavior);
    assert.equal(rejected.outcome.status, "not-evaluated");
    if (rejected.outcome.status === "not-evaluated") {
      assert.equal(rejected.outcome.failure.kind, "not-configured");
      assert.equal(rejected.outcome.attempts, 1);
    }
    assert.deepEqual(rejected.channelCalls, ["source-carrier"]);
    assert.deepEqual(rejected.credentialCalls, []);
    assert.equal(rejected.transportCalls, 0);
    assert.equal(rejected.client.mode, "direct");
  }
});
