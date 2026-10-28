/**
 * @module recall/tests/execution-resolution
 * resolveRecallExecution 一次通用能力决策后的按 Carrier kind 唯一选择；全部合成 catalog/registry，零 provider 请求。
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  loadTargetTagCatalog,
  type ResolvedLiveTarget,
  type TargetTagCatalog,
} from "@x-agent-suite/llm-fixture";
import type { RecallEffects } from "../src/effects.ts";
import { resolveRecallExecution } from "../src/execution.ts";
import type {
  RecallExecutionProfile,
  RecallRegistry,
} from "../src/registry.ts";

type CliInstance = TargetTagCatalog["instances"]["cli"][number];

/** 读取仓库公共 TargetTag 词典；home 指向一次性空目录，避免私有实例叠加。 */
const dictionary = (async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "xas-recall-resolution-"));
  try {
    return (await loadTargetTagCatalog({ homeDir })).dictionary;
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
})();

const effects: RecallEffects = {
  kind: "none",
  attribution: "none",
  tools: "none",
  commands: { allow: [], deny: [] },
  maxSteps: 1,
  timeoutMs: 30_000,
  workspace: "isolated",
  cleanup: "required",
};

function cliInstance(id: string): CliInstance {
  return {
    id,
    carrier: "carrier",
    wires: ["openai-chat"],
    tags: [
      "cli.execution.one-shot",
      "cli.execution.unattended",
      "cli.session.ephemeral",
      "cli.context.context-files.off",
      "cli.context.extensions.off",
      "cli.context.skills.off",
      "cli.tools.none",
      "cli.io.jsonl",
    ],
  };
}

function profile(carrier = "carrier"): RecallExecutionProfile {
  return {
    carrier,
    createDriver: () => {
      throw new Error("解析测试不应创建 Driver");
    },
  };
}

function target(
  kind?: ResolvedLiveTarget["kind"],
  clientRef?: string,
): ResolvedLiveTarget {
  return {
    carrier: "carrier",
    ...(kind === undefined ? {} : { kind }),
    ...(clientRef === undefined ? {} : { clientRef }),
    channel: {
      wire: "openai-chat",
      baseUrl: "https://never.invalid/v1",
      provider: "provider",
      model: "model",
    },
  };
}

async function resolve(options: {
  readonly target: ResolvedLiveTarget;
  readonly cli?: readonly CliInstance[];
  readonly liveTag?: string;
  readonly profiles?: Readonly<Record<string, RecallExecutionProfile>>;
  readonly liveReviewApproved?: boolean;
}) {
  const catalog: TargetTagCatalog = {
    dictionary: await dictionary,
    instances: {
      cli: options.cli ?? [cliInstance("cli-a")],
      providers: [
        {
          id: "provider",
          tags: [
            "provider.usage.api-credit",
            options.liveTag ?? "provider.usage.live.allowed",
          ],
        },
      ],
      providerModels: [
        {
          id: "provider-model",
          providerRef: "provider",
          model: "model",
          modelRef: "model",
          wire: "openai-chat",
          tags: ["provider-model.api.complete"],
        },
      ],
      models: [{ id: "model", tags: ["model.inference.chat"] }],
    },
  };
  const registry: RecallRegistry = {
    criteria: [],
    profiles: options.profiles ?? { "cli-a": profile() },
    effectsProfiles: {},
  };
  return resolveRecallExecution({
    target: options.target,
    catalog,
    effects,
    registry,
    liveReviewApproved: options.liveReviewApproved ?? true,
  });
}

/** 拆分决策诊断：保留原始前缀（决定错误种类）与 JSON 明细。 */
function diagnostic(error: unknown): {
  readonly prefix: string;
  readonly payload: Record<string, unknown>;
} {
  if (!(error instanceof Error)) {
    throw new Error("期望 Error，实际：" + String(error));
  }
  const at = error.message.indexOf("{");
  if (at < 0) throw new Error("诊断缺少 JSON 明细：" + error.message);
  return {
    prefix: error.message.slice(0, at),
    payload: JSON.parse(error.message.slice(at)) as Record<string, unknown>,
  };
}

test("cli 目标唯一 registered borrowed profile 返回完整执行实现", async () => {
  const borrowed = profile();
  const result = await resolve({
    target: target("cli"),
    profiles: { "cli-a": borrowed },
  });
  assert.equal(result.mode, "borrowed");
  assert.equal(result.cliRef, "cli-a");
  assert.equal(result.profile, borrowed);
  assert.equal(result.clientRef, undefined);
  assert.deepEqual(result.target, target("cli"));
});

test("borrowed 多命中未唯一时拒绝，诊断保留 allowed 与 registered", async () => {
  await assert.rejects(
    resolve({
      cli: [cliInstance("cli-a"), cliInstance("cli-b")],
      target: target("cli"),
      profiles: { "cli-a": profile(), "cli-b": profile() },
    }),
    (error: unknown) => {
      const { prefix, payload } = diagnostic(error);
      assert.equal(prefix, "Recall 执行实现未唯一确定：");
      assert.equal(payload.requiredMode, "borrowed");
      assert.equal(payload.live, "allowed");
      const details = payload.details as readonly Record<string, unknown>[];
      assert.deepEqual(
        details.map((detail) => [
          detail.mode,
          detail.cliRef,
          detail.allowed,
          detail.registered,
        ]),
        [
          ["direct", undefined, true, false],
          ["borrowed", "cli-a", true, true],
          ["borrowed", "cli-b", true, true],
        ],
      );
      return true;
    },
  );
});

test("只有 carrier 一致的 registered borrowed 候选参与唯一性判断", async () => {
  const second = profile();
  const result = await resolve({
    cli: [cliInstance("cli-a"), cliInstance("cli-b")],
    target: target("cli"),
    profiles: { "cli-a": profile("other-carrier"), "cli-b": second },
  });
  assert.equal(result.cliRef, "cli-b");
  assert.equal(result.profile, second);
});

test("ephemeral-client 一次决策后直接返回完整 profile 与 clientRef", async () => {
  const adapter = profile();
  const result = await resolve({
    target: target("ephemeral-client", "client-a"),
    profiles: { "client-a": adapter },
  });
  assert.deepEqual(Object.keys(result).sort(), [
    "clientRef",
    "mode",
    "profile",
    "target",
  ]);
  assert.equal(result.mode, "direct");
  assert.equal(result.clientRef, "client-a");
  assert.equal(result.profile, adapter);
  assert.equal(result.cliRef, undefined);
});

test("ephemeral-client 未注册 clientRef 时拒绝，不回退 direct 或 borrowed", async () => {
  await assert.rejects(
    resolve({ target: target("ephemeral-client", "missing"), profiles: {} }),
    (error: unknown) => {
      const { prefix, payload } = diagnostic(error);
      assert.equal(prefix, "Recall ephemeral-client 执行实现未唯一确定：");
      assert.deepEqual(payload, { carrier: "carrier", clientRef: "missing" });
      return true;
    },
  );
});

test("ephemeral-client 注册 profile carrier 不一致时同样拒绝", async () => {
  await assert.rejects(
    resolve({
      target: target("ephemeral-client", "client-a"),
      profiles: { "client-a": profile("other-carrier") },
    }),
    (error: unknown) => {
      const { prefix, payload } = diagnostic(error);
      assert.equal(prefix, "Recall ephemeral-client 执行实现未唯一确定：");
      assert.deepEqual(payload, { carrier: "carrier", clientRef: "client-a" });
      return true;
    },
  );
});

test("ephemeral-client live 未审批按 direct 能力决策拒绝，诊断不外泄注册匹配字段", async () => {
  await assert.rejects(
    resolve({
      liveTag: "provider.usage.live.review-required",
      target: target("ephemeral-client", "client-a"),
      profiles: { "client-a": profile() },
      liveReviewApproved: false,
    }),
    (error: unknown) => {
      const { prefix, payload } = diagnostic(error);
      assert.equal(prefix, "Recall 执行实现未唯一确定：");
      assert.equal(payload.requiredMode, "direct");
      assert.equal(payload.live, "review-required");
      const details = payload.details as readonly Record<string, unknown>[];
      assert.deepEqual(
        details.map((detail) => [detail.mode, detail.allowed]),
        [
          ["direct", false],
          ["borrowed", false],
        ],
      );
      assert.ok(details.every((detail) => !("registered" in detail)));
      return true;
    },
  );
});
