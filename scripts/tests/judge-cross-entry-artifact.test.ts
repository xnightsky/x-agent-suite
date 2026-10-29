/**
 * @module scripts/tests/judge-cross-entry-artifact
 * 独立公开 bundle 的 Judge/Assertions 错误分类与重试回归。
 * 不变量：仅使用发布入口与 fake client/transport；不读私密配置、零网络、零 token。
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import type {
  TurnCriterionContext,
  TurnObservation,
} from "@x-agent-suite/contracts";
import type { JudgeFailureKind, JudgeModelClient } from "@x-agent-suite/judge";
import type {
  ResolvedLiveTarget,
  TargetTagCatalog,
} from "@x-agent-suite/llm-fixture";

const ROOT = resolve(import.meta.dirname, "../..");
const SECRET = "DO_NOT_LEAK_RAW_PROMPT_RESPONSE_OR_CREDENTIAL";
const TURN = {
  index: 0,
  sent: "题面",
  text: SECRET,
  toolCalls: [],
  commands: [],
  startedAt: 0,
  endedAt: 1,
  metadata: {},
} satisfies TurnObservation;
const CONTEXT = {
  turnIndex: 0,
  session: {
    driver: "mock",
    turns: [],
    text: "",
    toolCalls: [],
    commands: [],
    exhausted: false,
    metadata: {},
  },
  expect: [{ name: "grounded", rubric: "回答是否基于证据" }],
} satisfies TurnCriterionContext;

let stage: string;
let judgeApi: typeof import("@x-agent-suite/judge");
let assertionsApi: typeof import("@x-agent-suite/assertions");
let dictionary: TargetTagCatalog["dictionary"];

before(async () => {
  await mkdir(join(ROOT, ".tmp"), { recursive: true });
  stage = await mkdtemp(join(ROOT, ".tmp", "xas-judge-cross-entry-"));
  const entries = {
    judge: join(ROOT, "packaging/entries/judge.ts"),
    assertions: join(ROOT, "packaging/entries/assertions.ts"),
    "llm-fixture": join(ROOT, "packaging/entries/llm-fixture.ts"),
  };
  const outdir = join(stage, "dist");
  await build({
    absWorkingDir: ROOT,
    entryPoints: entries,
    alias: {
      "@x-agent-suite/judge": entries.judge,
      "@x-agent-suite/assertions": entries.assertions,
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
  [judgeApi, assertionsApi] = await Promise.all([
    import(pathToFileURL(join(outdir, "judge.js")).href),
    import(pathToFileURL(join(outdir, "assertions.js")).href),
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

/** 经公开断言入口执行 fake client，并返回不可评测诊断。 */
async function assertionFailure(
  client: JudgeModelClient,
  maxRetries: number,
): Promise<string> {
  const criterion = assertionsApi.createJudgeAssertion({
    name: "artifact-judge",
    client,
    timeoutMs: 1000,
    maxRetries,
  });
  let failure: unknown;
  try {
    await criterion.evaluate(TURN, CONTEXT);
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof Error, "不可评测必须显式抛 Error");
  return failure.message;
}

/** 只允许 direct 唯一候选的合成公共目录。 */
function directCatalog(): TargetTagCatalog {
  return {
    dictionary,
    instances: {
      cli: [],
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
          model: "fixture-model",
          modelRef: "fixture-canonical",
          wire: "openai-chat",
          tags: ["provider-model.api.complete"],
        },
      ],
      models: [{ id: "fixture-canonical", tags: ["model.inference.chat"] }],
    },
  };
}

test("外部公开 JudgeModelError 跨 bundle 保留 transport 与重试预算", async () => {
  let calls = 0;
  const client: JudgeModelClient = {
    async complete() {
      calls += 1;
      throw new judgeApi.JudgeModelError("transport", "safe transport");
    },
  };
  const message = await assertionFailure(client, 3);
  assert.match(message, /^\[not-evaluated:transport\]/);
  assert.match(message, /safe transport/);
  assert.doesNotMatch(message, new RegExp(SECRET));
  assert.equal(calls, 2, "transport 类别预算应允许一次重试");
});

test("工厂 client 的执行错误跨 bundle 保留 transport 与重试预算", async (t) => {
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("NETWORK_FORBIDDEN");
  });
  const target = {
    carrier: "fixture-carrier",
    channel: {
      wire: "openai-chat",
      baseUrl: "https://fixture.invalid/v1",
      provider: "fixture-provider",
      model: "fixture-model",
      apiKey: "fixture-secret",
    },
  } satisfies ResolvedLiveTarget;
  let calls = 0;
  const client = judgeApi.createJudgeClient({
    target,
    tags: directCatalog(),
    mode: "direct",
    transport: async () => {
      calls += 1;
      return { status: 503, text: "upstream unavailable" };
    },
  });
  const message = await assertionFailure(client, 3);
  assert.match(message, /^\[not-evaluated:transport\]/);
  assert.doesNotMatch(message, /fixture-secret/);
  assert.doesNotMatch(message, new RegExp(SECRET));
  assert.equal(calls, 2, "工厂 client 的 transport 错误也应重试一次");
});

test("跨 bundle 保留其余已知 JudgeFailureKind", async () => {
  for (const kind of [
    "not-configured",
    "rate-limited",
    "timeout",
    "empty-response",
    "parse",
    "protocol",
    "cleanup",
    "client",
  ] satisfies readonly JudgeFailureKind[]) {
    let calls = 0;
    const client: JudgeModelClient = {
      async complete() {
        calls += 1;
        throw new judgeApi.JudgeModelError(kind, "safe " + kind);
      },
    };
    const message = await assertionFailure(client, 0);
    assert.match(message, new RegExp("^\\[not-evaluated:" + kind + "\\]"));
    assert.match(message, new RegExp("safe " + kind));
    assert.equal(calls, 1);
  }
});

test("伪造、畸形与未知错误保持 client、脱敏且不重试", async () => {
  const unknownKind = new judgeApi.JudgeModelError("transport", SECRET);
  Reflect.set(unknownKind, "kind", "not-a-judge-failure");
  const malformed = new judgeApi.JudgeModelError("transport", SECRET);
  Reflect.set(malformed, "message", { secret: SECRET });
  const spoofedError = Object.assign(new Error(SECRET), {
    name: "JudgeModelError",
    kind: "transport",
  });
  for (const failure of [
    new Error(SECRET),
    { name: "JudgeModelError", kind: "transport", message: SECRET },
    spoofedError,
    unknownKind,
    malformed,
  ]) {
    let calls = 0;
    const client: JudgeModelClient = {
      async complete() {
        calls += 1;
        throw failure;
      },
    };
    const message = await assertionFailure(client, 3);
    assert.match(message, /^\[not-evaluated:client\]/);
    assert.doesNotMatch(message, new RegExp(SECRET));
    assert.equal(calls, 1, "未识别错误不得自动重试");
  }
});
