/**
 * @module @x-agent-suite/assertions/tests/judge-assertion
 * AI 断言单元测试：fake 裁判客户端驱动，零 token、零网络。
 * 不变量：
 * - rubric 清单来自该轮 expect，判据配置不持有全局 rubric；
 * - 整体不可评测与 rubric 缺证据都显式抛错，绝不伪造成 0 分或 false；
 * - 只有模型明确给出的 false 才映射为 pass=false / score=0。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  CreateJudgeClientOptions,
  JudgeModelClient,
} from "@x-agent-suite/judge";
import {
  parseTargetTagDictionary,
  type LiveRequest,
  type LiveTransport,
  type ResolvedLiveTarget,
  type TargetTagCatalog,
} from "@x-agent-suite/llm-fixture";
import { createJudgeAssertion } from "../src/index.ts";
import { makeContext, makeTurn } from "./support.ts";

/** 记录 prompt 的假裁判客户端；reply 为 Error 时模拟执行失败。 */
function fakeJudge(reply: string | Error): {
  client: JudgeModelClient;
  prompts: string[];
} {
  const prompts: string[] = [];
  const client: JudgeModelClient = {
    async complete(request) {
      prompts.push(request.prompt);
      if (reply instanceof Error) throw reply;
      return { text: reply };
    },
  };
  return { client, prompts };
}

/** 两项 rubric，作为该轮 expect 传入。 */
const RUBRICS = [
  { name: "grounded", rubric: "回答是否基于观测证据" },
  { name: "bounded", rubric: "回答是否保留边界条件" },
];

/** 短超时 + 不重试，避免测试长驻与退避等待。 */
const OPTIONS = { name: "answer-quality", timeoutMs: 1000, maxRetries: 0 };

test("judge 断言：全部 rubric 通过则判定通过", async () => {
  const { client } = fakeJudge(
    '{"grounded":{"pass":true,"reason":"有证据"},"bounded":{"pass":true,"reason":"有边界"}}',
  );
  const criterion = createJudgeAssertion({ ...OPTIONS, client });
  assert.equal(criterion.scope, "turn");
  assert.equal(criterion.name, "answer-quality");
  const result = await criterion.evaluate(
    makeTurn("答案"),
    makeContext(RUBRICS),
  );
  assert.equal(result.pass, true);
  assert.equal(result.score, 1);
});

test("judge 断言：模型明确 false 才映射 0 分并点名理由", async () => {
  const { client } = fakeJudge(
    '{"grounded":{"pass":true,"reason":"有证据"},"bounded":{"pass":false,"reason":"缺边界"}}',
  );
  const criterion = createJudgeAssertion({ ...OPTIONS, client });
  const result = await criterion.evaluate(
    makeTurn("答案"),
    makeContext(RUBRICS),
  );
  assert.equal(result.pass, false);
  assert.equal(result.score, 0);
  assert.match(result.reason, /bounded/);
  assert.match(result.reason, /缺边界/);
});

test("judge 断言：rubric 缺证据显式抛错，不得当作 false", async () => {
  const { client } = fakeJudge('{"grounded":{"pass":true,"reason":"有证据"}}');
  const criterion = createJudgeAssertion({ ...OPTIONS, client });
  await assert.rejects(
    async () =>
      await criterion.evaluate(makeTurn("答案"), makeContext(RUBRICS)),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /^\[absent\]/);
      assert.match(error.message, /bounded/);
      return true;
    },
  );
});

test("judge 断言：整体不可评测显式抛错，保留 judge 失败类别", async () => {
  const { client } = fakeJudge(new Error("boom"));
  const criterion = createJudgeAssertion({ ...OPTIONS, client });
  await assert.rejects(
    async () =>
      await criterion.evaluate(makeTurn("答案"), makeContext(RUBRICS)),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /^\[not-evaluated:client\]/);
      assert.match(error.message, /answer-quality/);
      return true;
    },
  );
});

test("judge 断言：rubrics 逐个来自该轮 expect，不共享全局配置", async () => {
  const { client, prompts } = fakeJudge(
    '{"grounded":{"pass":true},"bounded":{"pass":true},"fresh":{"pass":true}}',
  );
  const criterion = createJudgeAssertion({ ...OPTIONS, client });
  await criterion.evaluate(makeTurn("第一轮"), makeContext(RUBRICS));
  await criterion.evaluate(
    makeTurn("第二轮"),
    makeContext([{ name: "fresh", rubric: "是否引用最新证据" }]),
  );
  assert.equal(prompts.length, 2);
  assert.match(prompts[0]!, /grounded/);
  assert.doesNotMatch(prompts[0]!, /fresh/);
  assert.match(prompts[1]!, /fresh/);
  assert.doesNotMatch(prompts[1]!, /grounded/);
});

test("judge 断言：被判文本取自 turn.text", async () => {
  const { client, prompts } = fakeJudge(
    '{"grounded":{"pass":true},"bounded":{"pass":true}}',
  );
  const criterion = createJudgeAssertion({ ...OPTIONS, client });
  await criterion.evaluate(makeTurn("本轮答案文本"), makeContext(RUBRICS));
  assert.match(prompts[0]!, /<Output>\n本轮答案文本\n<\/Output>/);
});

test("judge 断言：expect 形状非法由 Judge 现有校验显式拒绝且不发起调用", async () => {
  const illegal: unknown[] = [[], true, "grounded", [{ name: "", rubric: "" }]];
  for (const expect of illegal) {
    const { client, prompts } = fakeJudge("{}");
    const criterion = createJudgeAssertion({ ...OPTIONS, client });
    await assert.rejects(
      async () =>
        await criterion.evaluate(makeTurn("答案"), makeContext(expect)),
      /Judge/,
    );
    assert.equal(prompts.length, 0, "非法 expect 不得发起模型调用");
  }
});

test("judge 断言：判据名为空显式抛错", () => {
  const { client } = fakeJudge("{}");
  assert.throws(
    () => createJudgeAssertion({ ...OPTIONS, name: " ", client }),
    /非空字符串/,
  );
});

/** clientOptions 分支的测试底座：最小合法 TargetTags 目录与 direct target。 */
const TAG_DICTIONARY = parseTargetTagDictionary(`version: 1
keys:
  - { key: provider-model.api, scope: provider-model, dimension: api, status: maintained, values: [complete] }
  - { key: provider-model.usage, scope: provider-model, dimension: usage, status: maintained, values: [api-payg, api-credit, api-free] }
  - { key: model.inference, scope: model, dimension: inference, status: maintained, values: [chat] }
  - { key: provider.usage, scope: provider, dimension: usage, status: maintained, values: [live.allowed, live.review-required] }
  - { key: cli.execution, scope: cli, dimension: execution, status: maintained, values: [one-shot, unattended] }
  - { key: cli.session, scope: cli, dimension: session, status: maintained, values: [ephemeral] }
  - { key: cli.context, scope: cli, dimension: context, status: maintained, values: [context-files.off, extensions.off, skills.off] }
  - { key: cli.tools, scope: cli, dimension: tools, status: maintained, values: [none, allowlist, read-only] }
  - { key: cli.io, scope: cli, dimension: io, status: maintained, values: [text, jsonl] }
`);

/** 按 live 策略构造最小实例目录；空数组表示缺 tags 的非法场景。 */
function tagCatalog(liveTag: string): TargetTagCatalog {
  return {
    dictionary: TAG_DICTIONARY,
    instances: {
      cli: [],
      providers: [{ id: "fixture-provider", tags: [liveTag] }],
      providerModels: [
        {
          id: "fixture-provider/fixture-model",
          providerRef: "fixture-provider",
          model: "fixture-model",
          modelRef: "fixture-model",
          wire: "openai-chat",
          tags: [
            "provider-model.api.complete",
            "provider-model.usage.api-credit",
          ],
        },
      ],
      models: [{ id: "fixture-model", tags: ["model.inference.chat"] }],
    },
  };
}

const DIRECT_TARGET: ResolvedLiveTarget = {
  carrier: "fixture-carrier",
  channel: {
    wire: "openai-chat",
    baseUrl: "https://fixture.invalid/v1",
    model: "fixture-model",
    provider: "fixture-provider",
    apiKey: "fixture-key",
  },
};

/** 记录请求数的 fake transport；固定返回一条明确通过的 verdict。 */
function fakeTransport(): {
  transport: LiveTransport;
  requests: LiveRequest[];
} {
  const requests: LiveRequest[] = [];
  const transport: LiveTransport = async (request) => {
    requests.push(request);
    return {
      status: 200,
      text: JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content:
                '{"grounded":{"pass":true,"reason":"有证据"},"bounded":{"pass":true,"reason":"有边界"}}',
            },
          },
        ],
      }),
    };
  };
  return { transport, requests };
}

/** direct 模式 clientOptions；liveReviewApproved 缺省时不下发该字段。 */
function directClientOptions(options: {
  transport: LiveTransport;
  liveTag?: string;
  liveReviewApproved?: boolean;
}): CreateJudgeClientOptions {
  return {
    mode: "direct",
    target: DIRECT_TARGET,
    tags: tagCatalog(options.liveTag ?? "provider.usage.live.allowed"),
    transport: options.transport,
    ...(options.liveReviewApproved !== undefined
      ? { liveReviewApproved: options.liveReviewApproved }
      : {}),
  };
}

test("judge 断言：client 与 clientOptions 必须恰有一个，双填或缺失均拒绝", () => {
  const { client } = fakeJudge("{}");
  const clientOptions = directClientOptions(fakeTransport());
  assert.throws(
    () =>
      createJudgeAssertion({
        ...OPTIONS,
        client,
        clientOptions,
      } as unknown as Parameters<typeof createJudgeAssertion>[0]),
    (error: unknown) => {
      assert.ok(error instanceof TypeError);
      assert.match(error.message, /恰有一个/);
      assert.doesNotMatch(error.message, /fixture/);
      return true;
    },
  );
  assert.throws(
    () =>
      createJudgeAssertion({ ...OPTIONS } as unknown as Parameters<
        typeof createJudgeAssertion
      >[0]),
    (error: unknown) => {
      assert.ok(error instanceof TypeError);
      assert.match(error.message, /恰有一个/);
      return true;
    },
  );
});

test("judge 断言：clientOptions 构造阶段不联网、不调用模型", () => {
  const { transport, requests } = fakeTransport();
  createJudgeAssertion({
    ...OPTIONS,
    clientOptions: directClientOptions({ transport }),
  });
  assert.equal(requests.length, 0, "构造阶段不得发起 transport 调用");
});

test("judge 断言：clientOptions 经原生工厂走 direct + fake transport 完成判定", async () => {
  const { transport, requests } = fakeTransport();
  const criterion = createJudgeAssertion({
    ...OPTIONS,
    clientOptions: directClientOptions({ transport }),
  });
  assert.equal(criterion.scope, "turn");
  const result = await criterion.evaluate(
    makeTurn("答案"),
    makeContext(RUBRICS),
  );
  assert.equal(result.pass, true);
  assert.equal(result.score, 1);
  assert.equal(requests.length, 1);
  const body = requests[0]!.body as { model: string };
  assert.equal(body.model, "fixture-model");
});

test("judge 断言：live review-required 未批准在构造期拒绝，批准后放行", () => {
  const denied = fakeTransport();
  assert.throws(
    () =>
      createJudgeAssertion({
        ...OPTIONS,
        clientOptions: directClientOptions({
          transport: denied.transport,
          liveTag: "provider.usage.live.review-required",
        }),
      }),
    /Judge 无满足 TargetTags/,
  );
  assert.equal(denied.requests.length, 0);
  const approved = fakeTransport();
  createJudgeAssertion({
    ...OPTIONS,
    clientOptions: directClientOptions({
      transport: approved.transport,
      liveTag: "provider.usage.live.review-required",
      liveReviewApproved: true,
    }),
  });
  assert.equal(approved.requests.length, 0);
});

test("judge 断言：缺 tags 在构造期由原生工厂拒绝", () => {
  const { transport } = fakeTransport();
  assert.throws(
    () =>
      createJudgeAssertion({
        ...OPTIONS,
        clientOptions: {
          mode: "direct",
          target: DIRECT_TARGET,
          transport,
        } as unknown as CreateJudgeClientOptions,
      }),
    /TargetTagCatalog 必填/,
  );
});
