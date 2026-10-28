/**
 * @module @x-agent-suite/judge/tests/client-cancel
 * borrowed Judge 取消竞态单测：用 gate 驱动精确控制 start / sendPrompt
 * 的完成时机，验证预先 abort 不触达 factory/start/send、start 挂起时 abort
 * 仍 close 且其后绝不再 sendPrompt、已进入 send 后 abort 不重试不二次 close。
 * 不变量：全部为进程内 fake driver，零 token、不连真实宿主、不 sleep 猜时序。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { AgentDriver, Observation } from "@x-agent-suite/contracts";
import {
  parseTargetTagDictionary,
  type ResolvedLiveTarget,
  type TargetTagCatalog,
} from "@x-agent-suite/llm-fixture";
import {
  createJudgeClient,
  JudgeModelError,
  type BorrowedJudgeClientOptions,
} from "../src/index.ts";

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const dictionary = parseTargetTagDictionary(
  await readFile(join(REPO_ROOT, "config/target-tags/keys.yaml"), "utf8"),
);

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

const CLEAN_CLI_TAGS = [
  "cli.execution.one-shot",
  "cli.execution.unattended",
  "cli.session.ephemeral",
  "cli.context.context-files.off",
  "cli.context.extensions.off",
  "cli.context.skills.off",
  "cli.tools.none",
  "cli.io.text",
];

const catalog: TargetTagCatalog = {
  dictionary,
  instances: {
    cli: [
      {
        id: "fixture-cli",
        carrier: target.carrier,
        wires: [target.channel.wire],
        tags: CLEAN_CLI_TAGS,
      },
    ],
    providers: [
      {
        id: "fixture-provider",
        tags: [
          "provider.usage.api-payg",
          "provider.usage.third-party-subscription",
          "provider.usage.live.allowed",
        ],
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

/** 手控闸门：open 前 promise 永挂起，用于固定异步完成时机。 */
interface Gate {
  readonly promise: Promise<void>;
  readonly open: () => void;
}

/** 创建一个未开启的闸门。 */
function gate(): Gate {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/** 让已排队的微任务与 setImmediate 全部跑完（非 sleep）。 */
async function flushAsync(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

/** 构造最小 Observation。 */
function observation(text: string): Observation {
  return { text, toolCalls: [], toolCallsCount: 0, events: [] };
}

/** gate 驱动：start/sendPrompt 各自可被测试卡住，全部调用追加到 log。 */
function gatedDriver(
  log: string[],
  startGate: Gate,
  sendGate?: Gate,
): AgentDriver {
  return {
    async start() {
      log.push("start");
      await startGate.promise;
    },
    async sendPrompt() {
      log.push("sendPrompt");
      await sendGate?.promise;
      return observation('{"correct":true}');
    },
    events: async function* () {},
    async close() {
      log.push("close");
    },
  };
}

/** borrowed 客户端选项：唯一候选，createDriver 由调用方注入。 */
function borrowedOptions(
  createDriver: BorrowedJudgeClientOptions["createDriver"],
): BorrowedJudgeClientOptions {
  return { target, tags: catalog, mode: "borrowed", createDriver };
}

/** 取消路径应维持既有 abort 类别：transport + 已中止诊断。 */
function isAbortError(error: unknown): boolean {
  return (
    error instanceof JudgeModelError &&
    error.kind === "transport" &&
    /已中止/.test(error.message)
  );
}

test("borrowed 预先 abort 时不调用 factory/start/send", async () => {
  const controller = new AbortController();
  controller.abort();
  let factoryCalls = 0;
  const client = createJudgeClient(
    borrowedOptions(() => {
      factoryCalls += 1;
      return gatedDriver([], gate());
    }),
  );
  await assert.rejects(
    client.complete({ prompt: "judge", signal: controller.signal }),
    isAbortError,
  );
  assert.equal(factoryCalls, 0);
});

test("borrowed start 挂起时 abort 仍 close，start 后不再 sendPrompt", async () => {
  const log: string[] = [];
  const startGate = gate();
  const controller = new AbortController();
  const client = createJudgeClient(
    borrowedOptions(() => {
      log.push("factory");
      return gatedDriver(log, startGate);
    }),
  );
  const attempt = client.complete({
    prompt: "judge",
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(attempt, isAbortError);
  await flushAsync();
  assert.deepEqual(log, ["factory", "start", "close"]);

  startGate.open();
  await flushAsync();
  assert.equal(
    log.filter((entry) => entry === "sendPrompt").length,
    0,
    `start resolve 后不得再 sendPrompt，实际日志: ${JSON.stringify(log)}`,
  );
});

test("borrowed 已进入 sendPrompt 后 abort 仍 close，不重试不二次关闭", async () => {
  const log: string[] = [];
  const startGate = gate();
  startGate.open();
  const sendGate = gate();
  const controller = new AbortController();
  const client = createJudgeClient(
    borrowedOptions(() => gatedDriver(log, startGate, sendGate)),
  );
  const attempt = client.complete({
    prompt: "judge",
    signal: controller.signal,
  });
  await flushAsync();
  assert.deepEqual(log, ["start", "sendPrompt"]);

  controller.abort();
  await assert.rejects(attempt, isAbortError);
  await flushAsync();
  assert.deepEqual(log, ["start", "sendPrompt", "close"]);

  sendGate.open();
  await flushAsync();
  assert.deepEqual(log, ["start", "sendPrompt", "close"]);
});
